-- 物資出庫：取消出庫（單筆品項）＋庫存退回
--
-- 需求：出庫紀錄要可以取消，而且是「一項物資一項物資」地取消，
--       取消後該筆的數量要補回原本扣的那個庫存批次。
--
-- 設計取捨：
--   1. 不刪除紀錄，改成標記 is_cancelled —— 出庫是有法律／稽核意義的發放紀錄，
--      刪掉就查不到「誰在什麼時候發了又取消」。這也跟轉移用 status='Cancelled'
--      而不是刪列的作法一致。
--   2. 一列 supply_outbound_log = 一項物資，所以「單一品項取消」＝取消一列，
--      不需要另外設計。批次出庫的其他列不受影響。
--   3. 退回的對象是原本扣的那一列 supply_item（用 supply_item_id 直接指回去），
--      不是「找一個相同品項的批次」—— 效期是綁在批次上的，不能混。
--
-- Migration 是 append-only（見 Markdown/Architecture.md §五-1）：這裡不動
-- 20260823000001，另外開一個時間戳更晚的檔案。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) supply_outbound_log 新增取消相關欄位
-- ----------------------------------------------------------------------------
alter table supply_outbound_log
    add column if not exists is_cancelled boolean not null default false,
    add column if not exists cancelled_at timestamptz,
    add column if not exists cancelled_by text,
    add column if not exists cancel_reason text;

create index if not exists ix_supply_outbound_log_is_cancelled on supply_outbound_log(is_cancelled);

comment on column supply_outbound_log.is_cancelled is '是否已取消；取消時數量會退回 supply_item，紀錄本身保留供稽核';
comment on column supply_outbound_log.cancelled_at is '取消時間';
comment on column supply_outbound_log.cancelled_by is '執行取消的人員（display_name／username）';
comment on column supply_outbound_log.cancel_reason is '取消原因（選填）';

-- ----------------------------------------------------------------------------
-- 2) outbound_cancel — 取消一筆出庫並把數量退回原批次
--
-- 退回的寫法比照 transfer_cancel（20260818000001）：
-- quantity 加回去的同時把 is_active 設回 true，因為那一列有可能在數量歸零後
-- 被停用；只加數量卻留著 is_active=false，庫存看起來就會「憑空消失」。
-- ----------------------------------------------------------------------------
create or replace function outbound_cancel(
    p_log_id integer,
    p_cancelled_by text,
    p_reason text
) returns supply_outbound_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_log supply_outbound_log;
    v_item supply_item;
begin
    -- for update：兩個人同時按取消時，第二個人會等第一個人做完，
    -- 然後在下面的 is_cancelled 檢查被擋下來，不會退回兩次。
    select * into v_log from supply_outbound_log
    where id = p_log_id
    for update;

    if not found then
        raise exception '找不到這筆出庫紀錄';
    end if;

    if v_log.is_cancelled then
        raise exception '這筆出庫紀錄已經取消過了';
    end if;

    select * into v_item from supply_item
    where id = v_log.supply_item_id
    for update;

    if not found then
        raise exception '找不到對應的物資批次，無法退回庫存（物資編號 %）', v_log.supply_item_id;
    end if;

    update supply_item
    set quantity = quantity + v_log.outbound_quantity,
        is_active = true,
        updated_at = now()
    where id = v_item.id;

    update supply_outbound_log
    set is_cancelled = true,
        cancelled_at = now(),
        cancelled_by = p_cancelled_by,
        cancel_reason = nullif(trim(coalesce(p_reason, '')), '')
    where id = v_log.id
    returning * into v_log;

    return v_log;
end;
$$;

-- 與其他交易函式一致：只有 Edge Function 用的 service_role 能執行。
revoke execute on function outbound_cancel from public, anon, authenticated;
grant execute on function outbound_cancel to service_role;

comment on function outbound_cancel is '取消單一筆出庫紀錄並把數量退回原本的 supply_item 批次；紀錄保留並標記 is_cancelled';

-- ----------------------------------------------------------------------------
-- 3) recipient_analysis_view 必須排除已取消的紀錄
--
-- ⚠️ 這是「領取分析」那條切片的 view（Architecture.md §二 第 9 列），
-- 原則上不該由出庫這條切片動它。但取消功能一上線，被取消的發放如果還算進
-- 領取次數，那頁的數字就是錯的 —— 這是本次改動直接造成的問題，所以一起修掉。
-- 只多一個 where，欄位與型別完全不變。
--
-- create or replace view 會保留 security_invoker 設定，但這裡仍明確重申一次
-- （見 20260812000004_fix_view_security.sql）。
-- ----------------------------------------------------------------------------
create or replace view recipient_analysis_view as
select
    recipient_name,
    coalesce(recipient_contact, '') as recipient_contact,
    count(*) as pickup_count,
    count(distinct supply_item_id) as distinct_item_count,
    min(outbound_time) as first_pickup_date,
    max(outbound_time) as last_pickup_date
from supply_outbound_log
where not is_cancelled
group by recipient_name, coalesce(recipient_contact, '');

alter view recipient_analysis_view set (security_invoker = true);

comment on view recipient_analysis_view is '領取分析：依領用人彙總，已取消的出庫不列入計算';

