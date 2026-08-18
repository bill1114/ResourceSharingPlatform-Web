-- 轉移「加回既有資料列」的兩個修正（手機物資轉讓回報的問題）。
-- 兩支函式的其他行為（權限、狀態檢查、Pending -> Confirmed/Cancelled）都不變，
-- 只改「數量要加到哪一列」這件事。

-- ============================================================================
-- 1) transfer_confirm — 目標據點確認送達時，數量沒有加總到既有的那一列
--
-- 原本的比對條件把 inventory_item_variant_id 也當成批次識別的一部分
-- （is not distinct from），但那是「目錄連結」不是批次身分：同一個據點的同一
-- 項物資，可能一列是從物資入庫建立的（有 variant 連結），另一列是 AI 智慧入庫
-- 或舊資料建立的（variant 為 null）。只要兩邊的連結狀態不一樣，比對就找不到，
-- 於是新增一列而不是把數量加上去 —— 畫面上就是「同一項物資變成兩列、數量沒加總」。
--
-- 這裡改成：種類／名稱／規格／效期一致就視為同一批（效期仍必須完全相同，
-- 不同效期本來就該分列），variant 只在「兩邊都有值且不同」時才排除。
-- 若剛好合併到一列沒有 variant 連結的既有資料，順便把來源的連結補上去。
-- ============================================================================
create or replace function transfer_confirm(
    p_log_id integer,
    p_confirmed_by text
) returns supply_transfer_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_log supply_transfer_log;
    v_source supply_item;
    v_target supply_item;
    v_definition_id integer;
    v_safety_stock integer := 0;
begin
    select * into v_log from supply_transfer_log
    where id = p_log_id and status = 'Pending'
    for update;
    if not found then
        raise exception '找不到待確認的轉移紀錄，可能已經處理過';
    end if;

    select * into v_source from supply_item where id = v_log.supply_item_id;
    if not found then raise exception '找不到對應的物資資料'; end if;

    select * into v_target from supply_item
    where location_id = v_log.to_location_id
      and category = v_source.category
      and item_name = v_source.item_name
      and specification is not distinct from v_source.specification
      and expiration_date is not distinct from v_source.expiration_date
      and (
            inventory_item_variant_id is not distinct from v_source.inventory_item_variant_id
         or inventory_item_variant_id is null
         or v_source.inventory_item_variant_id is null
      )
      and is_active
    -- variant 完全相同的優先，其次才是連結缺一邊的那種
    order by (inventory_item_variant_id is not distinct from v_source.inventory_item_variant_id) desc, id
    limit 1
    for update;

    if found then
        update supply_item
        set quantity = quantity + v_log.transfer_quantity,
            inventory_item_variant_id = coalesce(inventory_item_variant_id, v_source.inventory_item_variant_id),
            updated_at = now()
        where id = v_target.id;
    else
        if v_source.inventory_item_variant_id is not null then
            select inventory_item_definition_id into v_definition_id
            from inventory_item_variant where id = v_source.inventory_item_variant_id;
            if v_definition_id is not null then
                select safety_stock into v_safety_stock
                from location_inventory_safety_stock
                where location_id = v_log.to_location_id
                  and inventory_item_definition_id = v_definition_id;
                v_safety_stock := coalesce(v_safety_stock, 0);
            end if;
        end if;

        insert into supply_item
            (category, item_name, specification, quantity, unit, stock_type,
             expiration_date, image_path, inventory_item_variant_id, location_id,
             safety_stock, remark, is_active)
        values
            (v_source.category, v_source.item_name, v_source.specification,
             v_log.transfer_quantity, v_source.unit, v_source.stock_type,
             v_source.expiration_date, v_source.image_path,
             v_source.inventory_item_variant_id, v_log.to_location_id,
             v_safety_stock, v_source.remark, true);
    end if;

    update supply_transfer_log
    set status = 'Confirmed', confirmed_by = p_confirmed_by, confirmed_at = now()
    where id = v_log.id returning * into v_log;
    return v_log;
end;
$$;

-- ============================================================================
-- 2) transfer_cancel — 取消／退回時，退回的數量沒有回到既有的來源資料列
--
-- 原本只做 quantity + n。轉移建立時會先把來源扣掉，整批轉出的批次會變成 0，
-- 而數量 0 的列在物資清單上常被當成空批次「刪除」（軟刪除 is_active = false）。
-- 之後目標據點按取消，數量就加回一列已停用、任何畫面都看不到的資料列 ——
-- 使用者看到的就是「退回的物資沒有加回去」。既然貨其實從沒離開來源據點，
-- 這裡連 is_active 一起還原。
-- ============================================================================
create or replace function transfer_cancel(
    p_log_id integer,
    p_cancelled_by text
) returns supply_transfer_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_log supply_transfer_log;
begin
    select * into v_log from supply_transfer_log
    where id = p_log_id and status = 'Pending'
    for update;
    if not found then
        raise exception '找不到待確認的轉移紀錄，可能已經處理過';
    end if;

    update supply_item
    set quantity = quantity + v_log.transfer_quantity,
        is_active = true,
        updated_at = now()
    where id = v_log.supply_item_id;
    if not found then raise exception '找不到對應的來源物資資料'; end if;

    update supply_transfer_log
    set status = 'Cancelled', confirmed_by = p_cancelled_by, confirmed_at = now()
    where id = v_log.id returning * into v_log;
    return v_log;
end;
$$;

-- create or replace 會保留原本的權限設定，這裡仍明確重申一次：只有 Edge Function
-- 用的 service_role 可以執行。
revoke execute on function transfer_confirm from public, anon, authenticated;
revoke execute on function transfer_cancel from public, anon, authenticated;
grant execute on function transfer_confirm to service_role;
grant execute on function transfer_cancel to service_role;
