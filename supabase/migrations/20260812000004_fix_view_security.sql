-- 修正：view 預設用建立者（管理者）權限執行，會繞過底層資料表的 RLS
-- （Supabase Table Editor 對這種 view 會標示紅色「UNRESTRICTED」警告）。
-- 加上 security_invoker = true（Postgres 15+ 支援）讓 view 改用「正在查詢的使用者」
-- 身份執行，這樣底層 supply_item / supply_donation_log / supply_outbound_log /
-- location_inventory_safety_stock / inventory_item_definition 上的據點範圍 RLS
-- 才會真的套用到透過這些 view 查詢的結果。

alter view supply_item_resolved set (security_invoker = true);
alter view location_low_stock_view set (security_invoker = true);
alter view global_low_stock_view set (security_invoker = true);
alter view donor_leaderboard_view set (security_invoker = true);
alter view recipient_analysis_view set (security_invoker = true);
