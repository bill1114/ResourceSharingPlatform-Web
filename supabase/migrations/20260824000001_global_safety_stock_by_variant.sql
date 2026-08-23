-- 全系統安全總量改為「物資種類 + 名稱 + 規格」各自設定與計算。
-- 各據點的 location_inventory_safety_stock 維持原本以品項定義為單位的警示規則。

alter table inventory_item_variant
    add column if not exists global_safety_stock integer not null default 0
    check (global_safety_stock >= 0);

comment on column inventory_item_variant.global_safety_stock is
    '全系統安全總量門檻；依物資種類、名稱及規格分開計算。0 代表尚未設定、不產生募資提醒。';

-- 原設定只有一個規格時，舊門檻可無歧義地轉移過來。
-- 有多個規格的品項無法自動分配舊門檻，保留為 0，請由管理員逐一設定。
with single_variant_definitions as (
    select inventory_item_definition_id
    from inventory_item_variant
    group by inventory_item_definition_id
    having count(*) = 1
)
update inventory_item_variant variant
set global_safety_stock = definition.global_safety_stock
from inventory_item_definition definition
join single_variant_definitions single_variant
    on single_variant.inventory_item_definition_id = definition.id
where variant.inventory_item_definition_id = definition.id
  and variant.global_safety_stock = 0
  and definition.global_safety_stock > 0;

-- 供全系統安全總量使用：優先採用已連結的規格；舊資料沒有 FK 時，
-- 依種類、名稱、規格找相同的有效規格，確保不同規格不會被混在一起。
create or replace view supply_item_resolved as
select
    si.*,
    coalesce(v_def.id, name_def.id) as resolved_definition_id,
    coalesce(v.id, fallback_variant.id) as resolved_variant_id
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
left join lateral (
    select candidate.id
    from inventory_item_variant candidate
    where candidate.inventory_item_definition_id = name_def.id
      and candidate.is_active
      and candidate.specification is not distinct from si.specification
    order by candidate.id
    limit 1
) fallback_variant on v.id is null
where si.is_active;

create or replace view global_low_stock_view as
select
    definition.id as inventory_item_definition_id,
    definition.category,
    definition.item_name,
    definition.unit,
    variant.global_safety_stock,
    coalesce(totals.total_quantity, 0) as total_quantity,
    -- 新欄位一律附加在既有 View 欄位之後；Postgres 不允許 CREATE OR REPLACE
    -- 在中段插入欄位，否則會把既有欄位名稱視為被改名。
    variant.id as inventory_item_variant_id,
    variant.specification
from inventory_item_variant variant
join inventory_item_definition definition
    on definition.id = variant.inventory_item_definition_id
left join (
    select resolved_variant_id, sum(quantity) as total_quantity
    from supply_item_resolved
    where resolved_variant_id is not null
    group by resolved_variant_id
) totals on totals.resolved_variant_id = variant.id
where definition.is_active
  and variant.is_active
  and variant.global_safety_stock > 0
  and coalesce(totals.total_quantity, 0) <= variant.global_safety_stock;

alter view supply_item_resolved set (security_invoker = true);
alter view global_low_stock_view set (security_invoker = true);

comment on view global_low_stock_view is
    '全系統安全總量警示：各據點庫存依物資種類、名稱、規格加總後，對照該規格的固定安全門檻；異常時應啟動募資。';
