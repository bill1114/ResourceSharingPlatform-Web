-- 物資出庫：批次出庫 + 領用人資料擴充
--
-- 對應需求：
--   (1) 領用人要記錄「所屬分局區／鄉鎮」與「身分別」
--   (2) 一次出庫可以派送多項物資（批次），且整批要在同一個交易裡完成
--
-- Migration 是 append-only（見 Markdown/Architecture.md §五-1），所以這裡不動
-- 20260813000001 的 outbound_create()，而是「新增欄位 + 新增一支批次版函式」。
-- 舊的 outbound_create() 原封不動保留，因為手機版領用（MobileFeatures 的
-- MobilePickup）與 LINE Bot 仍走單筆路徑。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) supply_outbound_log 新增四個欄位
--
-- 全部 nullable：既有資料列沒有這些資訊，硬加 not null 會讓 migration 失敗。
-- batch_id 的用法比照 supply_transfer_log.batch_id —— 同一次批次出庫產生的
-- 多列共用同一個 uuid，之後要把紀錄頁改成「一次領用一張單」時就靠它分組。
-- 單筆出庫（手機版／LINE Bot）的 batch_id 會是 null。
-- ----------------------------------------------------------------------------
alter table supply_outbound_log
    add column if not exists batch_id uuid,
    add column if not exists recipient_precinct text,
    add column if not exists recipient_district text,
    add column if not exists recipient_identity text;

create index if not exists ix_supply_outbound_log_batch_id on supply_outbound_log(batch_id);

comment on column supply_outbound_log.batch_id is '同一次批次出庫的分組鍵；單筆出庫為 null';
comment on column supply_outbound_log.recipient_precinct is '領用人所屬分局區（斗六／斗南／虎尾／西螺／北港／台西分局）';
comment on column supply_outbound_log.recipient_district is '領用人所屬鄉鎮市（雲林縣 20 個鄉鎮市）';
comment on column supply_outbound_log.recipient_identity is '領用人身分別：LowIncome／MidLowIncome／General／Other';

-- ----------------------------------------------------------------------------
-- 2) outbound_create_batch — 批次出庫
--
-- p_items 是 jsonb 陣列，每個元素 {"supplyItemId": 1, "quantity": 3}。
-- 整個迴圈跑在同一個交易裡：任何一項庫存不足就 raise exception，
-- 前面已經扣掉的數量會一起 rollback（這正是不能讓前端連續呼叫單筆版的原因）。
--
-- 同一個 supply_item_id 在陣列裡出現兩次是允許的：每次迴圈都重新
-- select ... for update，所以第二次看到的是已經扣過的數量，判斷仍然正確。
-- ----------------------------------------------------------------------------
create or replace function outbound_create_batch(
    p_location_id integer,
    p_items jsonb,
    p_recipient_name text,
    p_recipient_contact text,
    p_recipient_precinct text,
    p_recipient_district text,
    p_recipient_identity text,
    p_operator text,
    p_remark text
) returns setof supply_outbound_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_batch_id uuid := gen_random_uuid();
    v_entry jsonb;
    v_item_id integer;
    v_qty integer;
    v_item supply_item;
    v_log supply_outbound_log;
    v_count integer := 0;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception '請至少加入一項要出庫的物資';
    end if;

    if coalesce(trim(p_recipient_name), '') = '' then
        raise exception '請輸入領用人姓名';
    end if;

    for v_entry in select * from jsonb_array_elements(p_items)
    loop
        v_item_id := (v_entry ->> 'supplyItemId')::integer;
        v_qty := (v_entry ->> 'quantity')::integer;

        if v_item_id is null then
            raise exception '出庫清單中有一列沒有指定物資';
        end if;
        if v_qty is null or v_qty <= 0 then
            raise exception '出庫數量必須是大於 0 的整數';
        end if;

        select * into v_item from supply_item
        where id = v_item_id and location_id = p_location_id and is_active
        for update;

        if not found then
            raise exception '找不到指定據點的物資（編號 %）', v_item_id;
        end if;

        if v_item.quantity < v_qty then
            raise exception '「%」庫存不足，目前僅有 % %',
                v_item.item_name, v_item.quantity, coalesce(v_item.unit, '');
        end if;

        update supply_item set quantity = quantity - v_qty, updated_at = now()
        where id = v_item.id;

        insert into supply_outbound_log
            (supply_item_id, location_id, outbound_quantity, recipient_name, recipient_contact,
             "operator", remark, batch_id, recipient_precinct, recipient_district, recipient_identity)
        values
            (v_item.id, v_item.location_id, v_qty, trim(p_recipient_name), p_recipient_contact,
             p_operator, p_remark, v_batch_id, p_recipient_precinct, p_recipient_district, p_recipient_identity)
        returning * into v_log;

        v_count := v_count + 1;
        return next v_log;
    end loop;

    if v_count = 0 then
        raise exception '請至少加入一項要出庫的物資';
    end if;
end;
$$;

-- 與 20260813000001 的三支交易函式同樣的授權策略：只有 Edge Function
-- （service role）能呼叫，前端拿到的 anon／authenticated 角色不能直接執行。
revoke execute on function outbound_create_batch from public, anon, authenticated;
grant execute on function outbound_create_batch to service_role;

comment on function outbound_create_batch is '批次出庫：一位領用人一次領多項物資，整批同一交易；單筆出庫仍走 outbound_create';

