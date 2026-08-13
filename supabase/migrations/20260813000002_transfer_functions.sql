-- Atomic transfer workflow: create reserves stock at the source, confirm adds it
-- to the destination, and cancel restores it to the source.

create or replace function transfer_create(
    p_from_location_id integer,
    p_to_location_id integer,
    p_lines jsonb,
    p_operator text,
    p_remark text
) returns setof supply_transfer_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_batch_id uuid := gen_random_uuid();
    v_line record;
    v_item supply_item;
    v_log supply_transfer_log;
begin
    if p_from_location_id = p_to_location_id then
        raise exception '來源據點與目標據點不可相同';
    end if;
    if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
        raise exception '請至少選擇一項物資';
    end if;

    for v_line in
        select (x->>'supplyItemId')::integer as supply_item_id,
               sum((x->>'transferQuantity')::integer)::integer as transfer_quantity
        from jsonb_array_elements(p_lines) x
        group by (x->>'supplyItemId')::integer
    loop
        if v_line.transfer_quantity <= 0 then
            raise exception '轉移數量必須大於 0';
        end if;

        select * into v_item from supply_item
        where id = v_line.supply_item_id
          and location_id = p_from_location_id
          and is_active
        for update;

        if not found then
            raise exception '找不到來源物資（Id=%）', v_line.supply_item_id;
        end if;
        if v_item.quantity < v_line.transfer_quantity then
            raise exception '「%」來源數量不足，目前只有 % %', v_item.item_name, v_item.quantity, coalesce(v_item.unit, '');
        end if;

        update supply_item
        set quantity = quantity - v_line.transfer_quantity, updated_at = now()
        where id = v_item.id;

        insert into supply_transfer_log
            (batch_id, supply_item_id, from_location_id, to_location_id,
             transfer_quantity, status, "operator", remark)
        values
            (v_batch_id, v_item.id, p_from_location_id, p_to_location_id,
             v_line.transfer_quantity, 'Pending', p_operator, p_remark)
        returning * into v_log;
        return next v_log;
    end loop;
end;
$$;

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
      and inventory_item_variant_id is not distinct from v_source.inventory_item_variant_id
      and is_active
    order by id
    limit 1
    for update;

    if found then
        update supply_item set quantity = quantity + v_log.transfer_quantity, updated_at = now()
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
    set quantity = quantity + v_log.transfer_quantity, updated_at = now()
    where id = v_log.supply_item_id;
    if not found then raise exception '找不到對應的來源物資資料'; end if;

    update supply_transfer_log
    set status = 'Cancelled', confirmed_by = p_cancelled_by, confirmed_at = now()
    where id = v_log.id returning * into v_log;
    return v_log;
end;
$$;

revoke execute on function transfer_create from public, anon, authenticated;
revoke execute on function transfer_confirm from public, anon, authenticated;
revoke execute on function transfer_cancel from public, anon, authenticated;
grant execute on function transfer_create to service_role;
grant execute on function transfer_confirm to service_role;
grant execute on function transfer_cancel to service_role;

-- A destination user can see the source batch's name/spec/unit while viewing a
-- transfer addressed to their location. Mutation permissions remain unchanged.
drop policy if exists "supply_item_transfer_recipient_select" on supply_item;
create policy "supply_item_transfer_recipient_select" on supply_item
    for select to authenticated
    using (
        exists (
            select 1 from supply_transfer_log transfer
            where transfer.supply_item_id = supply_item.id
              and transfer.to_location_id = my_location_id()
        )
    );
