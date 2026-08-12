-- 地方物資管理平台 — Row Level Security policies
-- Pattern (see migration plan §二): Admin unrestricted; Cadre/SocialWorker scoped to
-- their own profiles.location_id for anything location-specific. Quantity-mutating
-- transactional operations (transfer/outbound/donation/disposal/ai-confirm) additionally
-- go through Edge Functions that re-validate role/location server-side before writing —
-- RLS here is the baseline floor, not the only check for those flows.

-- Helper: current caller's profile row, used repeatedly below.
create or replace function auth_profile()
returns profiles
language sql
security definer
stable
set search_path = public
as $$
    select * from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select coalesce((select role_name = 'Admin' from profiles where id = auth.uid()), false);
$$;

create or replace function my_location_id()
returns integer
language sql
security definer
stable
set search_path = public
as $$
    select location_id from profiles where id = auth.uid();
$$;

-- ============================================================================
-- supply_location — read: all authenticated; write: Admin only
-- ============================================================================
alter table supply_location enable row level security;

create policy "supply_location_select" on supply_location
    for select to authenticated using (true);
create policy "supply_location_admin_write" on supply_location
    for all to authenticated using (is_admin()) with check (is_admin());

-- ============================================================================
-- profiles — everyone can read their own row and (for the nav/badge display
-- of other users, e.g. transfer confirmed_by) all profiles; only Admin can
-- write directly (guarded edits like "don't deactivate the last Admin" go
-- through the user-account-update Edge Function, not raw RLS).
-- ============================================================================
alter table profiles enable row level security;

create policy "profiles_select" on profiles
    for select to authenticated using (true);
create policy "profiles_admin_write" on profiles
    for all to authenticated using (is_admin()) with check (is_admin());

-- ============================================================================
-- inventory_item_definition / inventory_item_variant / location_inventory_safety_stock
-- 庫存種類設定 — read: all authenticated; write: Admin only
-- ============================================================================
alter table inventory_item_definition enable row level security;
alter table inventory_item_variant enable row level security;
alter table location_inventory_safety_stock enable row level security;

create policy "inventory_item_definition_select" on inventory_item_definition
    for select to authenticated using (true);
create policy "inventory_item_definition_admin_write" on inventory_item_definition
    for all to authenticated using (is_admin()) with check (is_admin());

create policy "inventory_item_variant_select" on inventory_item_variant
    for select to authenticated using (true);
create policy "inventory_item_variant_admin_write" on inventory_item_variant
    for all to authenticated using (is_admin()) with check (is_admin());

create policy "location_inventory_safety_stock_select" on location_inventory_safety_stock
    for select to authenticated using (true);
create policy "location_inventory_safety_stock_admin_write" on location_inventory_safety_stock
    for all to authenticated using (is_admin()) with check (is_admin());

-- ============================================================================
-- supply_item — 物資管理: direct CRUD via supabase-js (no Edge Function needed
-- for plain add/edit/delete — only the quantity-mutating workflows below use
-- Edge Functions). Read/write scoped to Admin or the caller's own location.
-- ============================================================================
alter table supply_item enable row level security;

create policy "supply_item_select" on supply_item
    for select to authenticated
    using (is_admin() or location_id = my_location_id());
create policy "supply_item_write" on supply_item
    for all to authenticated
    using (is_admin() or location_id = my_location_id())
    with check (is_admin() or location_id = my_location_id());

-- ============================================================================
-- supply_transfer_log / supply_outbound_log / supply_donation_log / supply_disposal_log
-- 物資異動紀錄表 — INSERT/UPDATE only via their Edge Functions (transfer-create,
-- transfer-confirm, transfer-cancel, outbound-create, donation-create,
-- disposal-create), which run with the service role and bypass RLS after doing
-- their own role/location check. Client only gets SELECT here, scoped by location.
-- ============================================================================
alter table supply_transfer_log enable row level security;
alter table supply_outbound_log enable row level security;
alter table supply_donation_log enable row level security;
alter table supply_disposal_log enable row level security;

create policy "supply_transfer_log_select" on supply_transfer_log
    for select to authenticated
    using (is_admin() or from_location_id = my_location_id() or to_location_id = my_location_id());

create policy "supply_outbound_log_select" on supply_outbound_log
    for select to authenticated
    using (is_admin() or location_id = my_location_id());

create policy "supply_donation_log_select" on supply_donation_log
    for select to authenticated
    using (is_admin() or location_id = my_location_id());

create policy "supply_disposal_log_select" on supply_disposal_log
    for select to authenticated
    using (is_admin() or location_id = my_location_id());

-- ============================================================================
-- line_notification_settings / ai_stock_in_settings — 系統管理設定, Admin only
-- ============================================================================
alter table line_notification_settings enable row level security;
alter table ai_stock_in_settings enable row level security;

create policy "line_notification_settings_admin_all" on line_notification_settings
    for all to authenticated using (is_admin()) with check (is_admin());
create policy "ai_stock_in_settings_admin_all" on ai_stock_in_settings
    for all to authenticated using (is_admin()) with check (is_admin());

-- ============================================================================
-- ai_stock_in_log — select scoped by location; INSERT only via ai-stockin-confirm
-- Edge Function (service role).
-- ============================================================================
alter table ai_stock_in_log enable row level security;

create policy "ai_stock_in_log_select" on ai_stock_in_log
    for select to authenticated
    using (is_admin() or location_id = my_location_id());

-- ============================================================================
-- ai_stock_in_pending — a user only ever sees/touches their own in-progress
-- batch. The ai-stockin-* Edge Functions run as the calling user (not service
-- role) for this table, so normal RLS applies directly.
-- ============================================================================
alter table ai_stock_in_pending enable row level security;

create policy "ai_stock_in_pending_own" on ai_stock_in_pending
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- ============================================================================
-- catalog_synonym — read: all authenticated (used by AI matching + shown in
-- settings UI); write: Admin only.
-- ============================================================================
alter table catalog_synonym enable row level security;

create policy "catalog_synonym_select" on catalog_synonym
    for select to authenticated using (true);
create policy "catalog_synonym_admin_write" on catalog_synonym
    for all to authenticated using (is_admin()) with check (is_admin());

-- ============================================================================
-- notification_state — internal only, never exposed to the client. No policy
-- granted to `authenticated` at all; only the service-role key (used inside
-- Edge Functions) can read/write it, which bypasses RLS entirely.
-- ============================================================================
alter table notification_state enable row level security;
-- (deliberately no policies for `authenticated` — service role only)
