-- 缺料需求（舉手鍵，分工單 p.5/6/7）：在戰情總覽對某品項提出「缺貨求援」，指定
-- 來源據點與數量；需求全體可見，來源據點看到後可用「物資轉移」補貨。
create table if not exists supply_request (
    id integer generated always as identity primary key,
    category text not null,
    item_name text not null,
    specification text,
    requesting_location_id integer not null references supply_location(id),
    source_location_id integer references supply_location(id),
    quantity integer not null check (quantity > 0),
    status text not null default 'Open' check (status in ('Open', 'Fulfilled', 'Cancelled')),
    requested_by text,
    note text,
    fulfilled_transfer_batch_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz
);

alter table supply_request enable row level security;

-- 需求全體可見（p.5/6/7 最新確認：全部需求都全體可見）
create policy supply_request_select on supply_request
    for select to authenticated using (true);

-- 任何登入者都可提出需求
create policy supply_request_insert on supply_request
    for insert to authenticated with check (true);

-- 標記完成/取消：管理員，或來源／需求據點屬於自己
create policy supply_request_update on supply_request
    for update to authenticated
    using (is_admin() or requesting_location_id = my_location_id() or source_location_id = my_location_id())
    with check (is_admin() or requesting_location_id = my_location_id() or source_location_id = my_location_id());

create index if not exists idx_supply_request_status on supply_request (status);

comment on table supply_request is '缺料需求（舉手鍵）：據點提出缺貨求援，指定來源據點，供其透過物資轉移補貨';
