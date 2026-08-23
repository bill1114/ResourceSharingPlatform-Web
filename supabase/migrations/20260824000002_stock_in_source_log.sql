-- 入庫來源紀錄：每次正式入庫都保留一筆可後補的捐贈資料。
-- 入庫會增加庫存；後續補登／編輯捐贈人資料只能更新本表，絕不可再次加庫存。
create table if not exists supply_stock_in_log (
    id integer generated always as identity primary key,
    supply_item_id integer not null references supply_item(id),
    location_id integer not null references supply_location(id),
    stock_in_quantity integer not null check (stock_in_quantity > 0),
    donor_name text,
    donor_contact text,
    donor_address text,
    donor_precinct text,
    donor_district text,
    donor_identity text check (donor_identity in ('LowIncome', 'MidLowIncome', 'General', 'Other') or donor_identity is null),
    operator text,
    remark text,
    stock_in_time timestamptz not null default now(),
    updated_at timestamptz
);

-- 若先前執行到一半才失敗，既有資料表不會自動補上新欄位；這行讓 migration 可安全重跑。
alter table supply_stock_in_log add column if not exists donor_address text;

create index if not exists ix_supply_stock_in_log_supply_item_id on supply_stock_in_log(supply_item_id);
create index if not exists ix_supply_stock_in_log_location_id on supply_stock_in_log(location_id);

alter table supply_stock_in_log enable row level security;

drop policy if exists "supply_stock_in_log_select" on supply_stock_in_log;
create policy "supply_stock_in_log_select" on supply_stock_in_log
    for select to authenticated
    using (is_admin() or location_id = my_location_id());

drop policy if exists "supply_stock_in_log_write" on supply_stock_in_log;
create policy "supply_stock_in_log_write" on supply_stock_in_log
    for all to authenticated
    using (is_admin() or location_id = my_location_id())
    with check (is_admin() or location_id = my_location_id());

comment on table supply_stock_in_log is
    '正式入庫紀錄。捐贈人欄位可在入庫後補登或編輯；更新來源資料不會再次異動庫存。';
