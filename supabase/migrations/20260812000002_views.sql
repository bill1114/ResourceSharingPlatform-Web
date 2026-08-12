-- 地方物資管理平台 — cross-cutting views
-- These centralize logic that was duplicated in C# (DashboardService AND MapController
-- both hand-wrote the same "resolve SupplyItem -> InventoryItemDefinition" algorithm,
-- and again for low-stock detection). One view here, queried everywhere — see migration
-- plan §一.1/一.2/一.3.

-- ============================================================================
-- supply_item_resolved — every active supply_item, joined to its
-- inventory_item_definition. Prefers the normalized FK
-- (inventory_item_variant_id -> inventory_item_variant -> definition); falls
-- back to an exact (category, item_name) match against
-- inventory_item_definition when there's no variant link (mirrors the
-- fallback the C# code did for legacy/AI-confirmed rows before the
-- auto-create-catalog-entry fix in ai-stockin-confirm).
-- ============================================================================
create view supply_item_resolved as
select
    si.*,
    coalesce(v_def.id, name_def.id) as resolved_definition_id
from supply_item si
left join inventory_item_variant v
    on v.id = si.inventory_item_variant_id
left join inventory_item_definition v_def
    on v_def.id = v.inventory_item_definition_id
left join inventory_item_definition name_def
    on name_def.category = si.category
    and name_def.item_name = si.item_name
    and name_def.is_active
    and v_def.id is null
where si.is_active;

-- ============================================================================
-- location_low_stock_view — per-location safety stock breach, only for
-- location_inventory_safety_stock rows with safety_stock > 0 (a 0 threshold
-- means "no alert configured", matching the C# DashboardService rule).
-- ============================================================================
create view location_low_stock_view as
select
    lss.location_id,
    lss.inventory_item_definition_id,
    def.category,
    def.item_name,
    def.unit,
    lss.safety_stock,
    coalesce(totals.total_quantity, 0) as total_quantity
from location_inventory_safety_stock lss
join inventory_item_definition def on def.id = lss.inventory_item_definition_id
left join (
    select location_id, resolved_definition_id, sum(quantity) as total_quantity
    from supply_item_resolved
    group by location_id, resolved_definition_id
) totals
    on totals.location_id = lss.location_id
    and totals.resolved_definition_id = lss.inventory_item_definition_id
where lss.safety_stock > 0
  and coalesce(totals.total_quantity, 0) <= lss.safety_stock;

-- ============================================================================
-- global_low_stock_view —全系統合計 vs InventoryItemDefinition.GlobalSafetyStock
-- ============================================================================
create view global_low_stock_view as
select
    def.id as inventory_item_definition_id,
    def.category,
    def.item_name,
    def.unit,
    def.global_safety_stock,
    coalesce(totals.total_quantity, 0) as total_quantity
from inventory_item_definition def
left join (
    select resolved_definition_id, sum(quantity) as total_quantity
    from supply_item_resolved
    group by resolved_definition_id
) totals
    on totals.resolved_definition_id = def.id
where def.is_active
  and def.global_safety_stock > 0
  and coalesce(totals.total_quantity, 0) <= def.global_safety_stock;

-- ============================================================================
-- donor_leaderboard_view — SupplyDonation/Index's donor aggregate, now a
-- server-side view instead of pulling the whole log table to the client.
-- ============================================================================
create view donor_leaderboard_view as
select
    donor_name,
    coalesce(donor_contact, '') as donor_contact,
    count(*) as pickup_count,
    count(distinct supply_item_id) as distinct_item_count,
    min(donation_time) as first_donation_date,
    max(donation_time) as last_donation_date
from supply_donation_log
group by donor_name, coalesce(donor_contact, '');

-- ============================================================================
-- recipient_analysis_view — SupplyOutbound/RecipientAnalysis's equivalent
-- aggregate over recipients instead of donors.
-- ============================================================================
create view recipient_analysis_view as
select
    recipient_name,
    coalesce(recipient_contact, '') as recipient_contact,
    count(*) as pickup_count,
    count(distinct supply_item_id) as distinct_item_count,
    min(outbound_time) as first_pickup_date,
    max(outbound_time) as last_pickup_date
from supply_outbound_log
group by recipient_name, coalesce(recipient_contact, '');

comment on view supply_item_resolved is '取代 DashboardService 與 MapController 各自重複的 SupplyItem->InventoryItemDefinition 解析邏輯，兩邊都改查這裡';
comment on view location_low_stock_view is '據點層級安全庫存警示，只算 safety_stock > 0 的門檻列';
comment on view global_low_stock_view is '全系統層級安全庫存警示，對照 InventoryItemDefinition.GlobalSafetyStock';
