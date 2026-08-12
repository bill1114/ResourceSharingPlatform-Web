-- 地方物資管理平台 — Supabase Postgres schema
-- Translated from D:\ResourceSharingPlatform\...\Database\CreateDatabase.sql (SQL Server)
-- Naming: snake_case throughout (vs. the source's PascalCase) — see migration plan §一.
-- Type mapping: NVARCHAR->TEXT, DATETIME->TIMESTAMPTZ, BIT->BOOLEAN, DECIMAL->NUMERIC,
-- UNIQUEIDENTIFIER->UUID, INT IDENTITY->INTEGER GENERATED ALWAYS AS IDENTITY.

-- ============================================================================
-- supply_location (據點主檔)
-- ============================================================================
create table supply_location (
    id integer generated always as identity primary key,
    location_name text not null,
    address text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    contact_person text,
    phone text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz
);

-- ============================================================================
-- profiles (取代 UserAccount — 帳密移到 auth.users，這裡只留角色/據點/顯示名稱)
-- ============================================================================
create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text not null unique,
    display_name text,
    role_name text not null default 'SocialWorker'
        check (role_name in ('Admin', 'Cadre', 'SocialWorker')),
    location_id integer references supply_location(id),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz
);

create index ix_profiles_location_id on profiles(location_id);

-- ============================================================================
-- inventory_item_definition (物資目錄：種類＋名稱)
-- ============================================================================
create table inventory_item_definition (
    id integer generated always as identity primary key,
    category text not null,
    item_name text not null,
    unit text not null,
    global_safety_stock integer not null default 0
        check (global_safety_stock >= 0),
    stock_type text not null default 'HasExpiry'
        check (stock_type in ('NoExpiry', 'HasExpiry', 'Frozen')),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz
);

-- Partial unique index: active Category+ItemName combos can't repeat (mirrors
-- SQL Server's filtered unique index WHERE IsActive = 1).
create unique index ux_inventory_item_definition_active_name
    on inventory_item_definition(category, item_name)
    where is_active;

-- ============================================================================
-- inventory_item_variant (物資規格)
-- ============================================================================
create table inventory_item_variant (
    id integer generated always as identity primary key,
    inventory_item_definition_id integer not null
        references inventory_item_definition(id),
    specification text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz
);

create index ix_inventory_item_variant_definition_id
    on inventory_item_variant(inventory_item_definition_id);

create unique index ux_inventory_item_variant_active_specification
    on inventory_item_variant(inventory_item_definition_id, specification)
    where is_active;

-- ============================================================================
-- supply_item (核心表：據點內實際庫存批次)
-- ============================================================================
create table supply_item (
    id integer generated always as identity primary key,
    category text not null,
    item_name text not null,
    specification text,
    quantity integer not null default 0
        check (quantity >= 0),  -- was C#-only validation on SQL Server; now a real DB constraint
    unit text,
    stock_type text not null default 'HasExpiry'
        check (stock_type in ('NoExpiry', 'HasExpiry', 'Frozen')),
    expiration_date date,
    image_path text,
    inventory_item_variant_id integer references inventory_item_variant(id),
    location_id integer not null references supply_location(id),
    safety_stock integer not null default 0
        check (safety_stock >= 0),  -- legacy snapshot column, see IntegrationGuide.md §4
    remark text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz
);

create index ix_supply_item_location_id on supply_item(location_id);
create index ix_supply_item_category on supply_item(category);
create index ix_supply_item_stock_type on supply_item(stock_type);
create index ix_supply_item_inventory_item_variant_id on supply_item(inventory_item_variant_id);

-- ============================================================================
-- location_inventory_safety_stock (據點安全庫存門檻)
-- ============================================================================
create table location_inventory_safety_stock (
    id integer generated always as identity primary key,
    location_id integer not null references supply_location(id),
    inventory_item_definition_id integer not null references inventory_item_definition(id),
    safety_stock integer not null default 0 check (safety_stock >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz,
    unique (location_id, inventory_item_definition_id)
);

-- ============================================================================
-- supply_transfer_log (據點間調撥紀錄)
-- ============================================================================
create table supply_transfer_log (
    id integer generated always as identity primary key,
    batch_id uuid not null default gen_random_uuid(),
    supply_item_id integer not null references supply_item(id),
    from_location_id integer not null references supply_location(id),
    to_location_id integer not null references supply_location(id),
    transfer_quantity integer not null check (transfer_quantity > 0),
    transfer_time timestamptz not null default now(),
    status text not null default 'Pending'
        check (status in ('Pending', 'Confirmed', 'Cancelled')),
    confirmed_by text,
    confirmed_at timestamptz,
    "operator" text,
    remark text,
    check (from_location_id <> to_location_id)
);

create index ix_supply_transfer_log_batch_id on supply_transfer_log(batch_id);
create index ix_supply_transfer_log_from_location_id on supply_transfer_log(from_location_id);
create index ix_supply_transfer_log_to_location_id on supply_transfer_log(to_location_id);

-- ============================================================================
-- supply_outbound_log (出庫／領取紀錄)
-- ============================================================================
create table supply_outbound_log (
    id integer generated always as identity primary key,
    supply_item_id integer not null references supply_item(id),
    location_id integer not null references supply_location(id),
    outbound_quantity integer not null check (outbound_quantity > 0),
    recipient_name text not null,
    recipient_contact text,
    "operator" text,
    outbound_time timestamptz not null default now(),
    remark text
);

create index ix_supply_outbound_log_supply_item_id on supply_outbound_log(supply_item_id);
create index ix_supply_outbound_log_location_id on supply_outbound_log(location_id);

-- ============================================================================
-- supply_donation_log (捐贈入庫紀錄)
-- ============================================================================
create table supply_donation_log (
    id integer generated always as identity primary key,
    supply_item_id integer not null references supply_item(id),
    location_id integer not null references supply_location(id),
    donation_quantity integer not null check (donation_quantity > 0),
    donor_name text not null,
    donor_contact text,
    "operator" text,
    donation_time timestamptz not null default now(),
    remark text
);

create index ix_supply_donation_log_supply_item_id on supply_donation_log(supply_item_id);
create index ix_supply_donation_log_location_id on supply_donation_log(location_id);

-- ============================================================================
-- supply_disposal_log (報廢／損耗紀錄)
-- ============================================================================
create table supply_disposal_log (
    id integer generated always as identity primary key,
    supply_item_id integer not null references supply_item(id),
    location_id integer not null references supply_location(id),
    disposal_quantity integer not null check (disposal_quantity > 0),
    reason text not null default 'Other'
        check (reason in ('Expired', 'Damaged', 'Lost', 'Other')),
    "operator" text,
    disposal_time timestamptz not null default now(),
    remark text
);

create index ix_supply_disposal_log_supply_item_id on supply_disposal_log(supply_item_id);
create index ix_supply_disposal_log_location_id on supply_disposal_log(location_id);

-- ============================================================================
-- line_notification_settings (LINE 通知設定，單筆設定列)
-- ============================================================================
create table line_notification_settings (
    id integer generated always as identity primary key,
    is_enabled boolean not null default false,
    channel_access_token text,
    channel_secret text,
    notify_low_stock boolean not null default true,
    notify_expiring_soon boolean not null default true,
    notify_expired boolean not null default true,
    updated_at timestamptz,
    updated_by text
);

-- ============================================================================
-- ai_stock_in_settings (AI 智慧入庫設定，單筆設定列)
-- ApiKey/ApiEndpoint columns kept for UI-facing feature flags only; the actual
-- vision-provider keys live in Edge Function secrets, never read from this
-- table by the browser (see migration plan §四 & §13 open question).
-- ============================================================================
create table ai_stock_in_settings (
    id integer generated always as identity primary key,
    is_enabled boolean not null default false,
    api_endpoint text,
    api_key text,
    supports_image_input boolean not null default true,
    supports_text_input boolean not null default true,
    updated_at timestamptz,
    updated_by text
);

-- ============================================================================
-- ai_stock_in_log (AI 智慧入庫辨識與確認紀錄)
-- ============================================================================
create table ai_stock_in_log (
    id integer generated always as identity primary key,
    location_id integer not null references supply_location(id),
    input_type text not null default 'Image'
        check (input_type in ('Image', 'Text')),
    input_text text,
    input_image_path text,
    suggested_category text,
    suggested_item_name text,
    suggested_specification text,
    suggested_quantity integer,
    suggested_unit text,
    suggested_stock_type text,
    suggested_expiration_date date,
    suggested_safety_stock integer,
    suggested_remark text,
    confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
    raw_response text,
    is_confirmed boolean not null default false,
    confirmed_supply_item_id integer references supply_item(id),
    "operator" text,
    created_at timestamptz not null default now(),
    confirmed_at timestamptz
);

create index ix_ai_stock_in_log_location_id on ai_stock_in_log(location_id);
create index ix_ai_stock_in_log_confirmed_supply_item_id on ai_stock_in_log(confirmed_supply_item_id);

-- ============================================================================
-- ai_stock_in_pending (NEW — AI 辨識待確認暫存，取代 Python 原型的 SQLite 表)
-- 30-minute TTL, lazy-cleanup-on-read (see ai-stockin-* Edge Functions).
-- ============================================================================
create table ai_stock_in_pending (
    id bigint generated always as identity primary key,
    session_id uuid not null,
    user_id uuid not null references auth.users(id),
    location_id integer references supply_location(id),
    item_index integer not null,
    item_name text,
    category text,
    specification text,
    quantity integer,
    unit text,
    stock_type text,
    expiration_date date,
    confidence text,
    raw_ai_name text,
    mapping_note text,
    created_at timestamptz not null default now()
);

create index ix_ai_stock_in_pending_session_id on ai_stock_in_pending(session_id);
create index ix_ai_stock_in_pending_user_id on ai_stock_in_pending(user_id);

-- ============================================================================
-- catalog_synonym (NEW — AI 目錄比對用同義詞字典，Admin 可編輯，初始留空)
-- 「泡麵」「來一客」→「泡麵」這種對照，見 services/matching.py 概念移植，
-- 內容不照抄 Python 原型的測試資料，請使用者自行維護。
-- ============================================================================
create table catalog_synonym (
    id integer generated always as identity primary key,
    synonym text not null unique,
    standard_name text not null,
    created_at timestamptz not null default now()
);

-- ============================================================================
-- notification_state (NEW — LINE 通知去重複用的簽章存放，key-value)
-- ============================================================================
create table notification_state (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
);

comment on table ai_stock_in_pending is 'AI 辨識待確認暫存，30 分鐘 TTL，讀取時 lazy cleanup（見 Edge Functions，不用背景排程）';
comment on table catalog_synonym is 'AI 目錄比對同義詞字典，初始留空，需使用者自行維護內容';
comment on table notification_state is 'LINE 被動通知去重複用的內容簽章，只有 line-notify Edge Function 會寫入';
comment on column supply_item.category is '快照值，建立當下複製，目錄改名不會回頭更新這裡（刻意設計，非 bug）— 見 IntegrationGuide.md';
