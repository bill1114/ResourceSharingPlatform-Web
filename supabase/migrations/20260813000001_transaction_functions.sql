-- Postgres functions (SECURITY DEFINER) for the quantity-mutating operations that
-- need real atomicity (matches the C# Services' explicit
-- _context.Database.BeginTransactionAsync() usage). The Edge Functions
-- (outbound-create, donation-create, disposal-create) do auth/role/location
-- validation, then call these via the service-role client's .rpc() — the function
-- body itself runs as one Postgres transaction, so a failure partway through
-- rolls back everything (e.g. quantity decrement without the matching log row
-- can't happen).
--
-- IMPORTANT: these are revoked from anon/authenticated below and only granted to
-- service_role, so they can't be called directly via the public REST /rpc/
-- endpoint bypassing the Edge Functions' own permission checks.

create or replace function outbound_create(
    p_supply_item_id integer,
    p_location_id integer,
    p_outbound_quantity integer,
    p_recipient_name text,
    p_recipient_contact text,
    p_operator text,
    p_remark text
) returns supply_outbound_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item supply_item;
    v_log supply_outbound_log;
begin
    if p_outbound_quantity <= 0 then
        raise exception '出庫數量必須大於 0';
    end if;

    select * into v_item from supply_item
    where id = p_supply_item_id and location_id = p_location_id and is_active
    for update;

    if not found then
        raise exception '找不到指定據點的這項物資';
    end if;

    if v_item.quantity < p_outbound_quantity then
        raise exception '庫存數量不足，目前僅有 % %', v_item.quantity, coalesce(v_item.unit, '');
    end if;

    update supply_item set quantity = quantity - p_outbound_quantity, updated_at = now()
    where id = v_item.id;

    insert into supply_outbound_log
        (supply_item_id, location_id, outbound_quantity, recipient_name, recipient_contact, "operator", remark)
    values
        (v_item.id, v_item.location_id, p_outbound_quantity, p_recipient_name, p_recipient_contact, p_operator, p_remark)
    returning * into v_log;

    return v_log;
end;
$$;

create or replace function donation_create(
    p_supply_item_id integer,
    p_location_id integer,
    p_donation_quantity integer,
    p_donor_name text,
    p_donor_contact text,
    p_operator text,
    p_remark text
) returns supply_donation_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item supply_item;
    v_log supply_donation_log;
begin
    if p_donation_quantity <= 0 then
        raise exception '捐贈數量必須大於 0';
    end if;

    select * into v_item from supply_item
    where id = p_supply_item_id and location_id = p_location_id and is_active
    for update;

    if not found then
        raise exception '找不到指定據點的這項物資';
    end if;

    update supply_item set quantity = quantity + p_donation_quantity, updated_at = now()
    where id = v_item.id;

    insert into supply_donation_log
        (supply_item_id, location_id, donation_quantity, donor_name, donor_contact, "operator", remark)
    values
        (v_item.id, v_item.location_id, p_donation_quantity, p_donor_name, p_donor_contact, p_operator, p_remark)
    returning * into v_log;

    return v_log;
end;
$$;

create or replace function disposal_create(
    p_supply_item_id integer,
    p_location_id integer,
    p_disposal_quantity integer,
    p_reason text,
    p_operator text,
    p_remark text
) returns supply_disposal_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item supply_item;
    v_log supply_disposal_log;
begin
    if p_disposal_quantity <= 0 then
        raise exception '報廢數量必須大於 0';
    end if;
    if p_reason not in ('Expired', 'Damaged', 'Lost', 'Other') then
        raise exception '無效的報廢原因';
    end if;

    select * into v_item from supply_item
    where id = p_supply_item_id and location_id = p_location_id and is_active
    for update;

    if not found then
        raise exception '找不到指定據點的這項物資';
    end if;

    if v_item.quantity < p_disposal_quantity then
        raise exception '庫存數量不足，目前僅有 % %', v_item.quantity, coalesce(v_item.unit, '');
    end if;

    update supply_item set quantity = quantity - p_disposal_quantity, updated_at = now()
    where id = v_item.id;

    insert into supply_disposal_log
        (supply_item_id, location_id, disposal_quantity, reason, "operator", remark)
    values
        (v_item.id, v_item.location_id, p_disposal_quantity, p_reason, p_operator, p_remark)
    returning * into v_log;

    return v_log;
end;
$$;

revoke execute on function outbound_create from public, anon, authenticated;
revoke execute on function donation_create from public, anon, authenticated;
revoke execute on function disposal_create from public, anon, authenticated;
grant execute on function outbound_create to service_role;
grant execute on function donation_create to service_role;
grant execute on function disposal_create to service_role;
