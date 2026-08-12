-- 種子資料：8 個真實據點 + 物資目錄（39 個物資名稱／54 個規格）
-- 對應現有 .NET 系統 DbInitializer.SeedPresetLocationsAsync /
-- SeedPresetInventoryCatalogAsync 的同一份資料，直接搬過來，不重新輸入一次。
-- 這個檔案只在對應資料還不存在時才插入（用 WHERE NOT EXISTS 擋），可以安全重複執行。

-- ============================================================================
-- 8 個真實服務中心（雲林縣智障者福利協進會）
-- ============================================================================
insert into supply_location (location_name, address, phone, latitude, longitude, is_active)
select v.location_name, v.address, v.phone, v.latitude, v.longitude, true
from (values
    ('行政中心', '雲林縣斗六市府文路30號', '05-5341940', 23.6960101, 120.5278435),
    ('圓夢庇護工場', '雲林縣斗六市保長路504號', '05-5345467', 23.7059203, 120.5189915),
    ('雲林縣身心障礙者服務中心-斗六區', '雲林縣斗六市府文路22號4樓', '05-5362103', 23.6960101, 120.5278435),
    ('心歡喜日照中心', '雲林縣斗六市南京路373號1樓', '05-5372781', 23.7138970, 120.5393339),
    ('西螺服務據點', '雲林縣西螺鎮光復西路286號', '05-5873733', 23.7966480, 120.4594180),
    ('東勢服務中心', '雲林縣東勢鄉東北村東勢東路395號', '05-6993809', 23.6758407, 120.2618627),
    ('心圓寶日照中心', '雲林縣北港鎮新街里穎寧街72號', '05-7825113', 23.5788243, 120.2964091),
    ('北港服務中心', '雲林縣北港鎮新街里新東街33巷8之3號', '05-7827433', 23.5853932, 120.3010845)
) as v(location_name, address, phone, latitude, longitude)
where not exists (
    select 1 from supply_location sl where sl.location_name = v.location_name
);

-- ============================================================================
-- 物資目錄：39 個定義
-- ============================================================================
insert into inventory_item_definition (category, item_name, unit, stock_type, global_safety_stock, is_active)
select v.category, v.item_name, v.unit, v.stock_type, 0, true
from (values
    ('食品', '米', '包', 'HasExpiry'),
    ('食品', '水', '箱', 'HasExpiry'),
    ('食品', '米酒', '瓶', 'HasExpiry'),
    ('食品', '食用油', '瓶', 'HasExpiry'),
    ('食品', '醬油', '瓶', 'HasExpiry'),
    ('食品', '飲料', '鋁箔包', 'HasExpiry'),
    ('食品', '罐頭', '罐', 'HasExpiry'),
    ('食品', '綠豆', '包', 'HasExpiry'),
    ('食品', '鹽巴', '包', 'HasExpiry'),
    ('食品', '冬粉', '包', 'HasExpiry'),
    ('食品', '米粉', '包', 'HasExpiry'),
    ('食品', '麵條', '包', 'HasExpiry'),
    ('食品', '泡麵(袋裝)', '包', 'HasExpiry'),
    ('食品', '泡麵(碗裝)', '碗', 'HasExpiry'),
    ('生鮮冷凍食品', '蔬菜', '箱', 'Frozen'),
    ('生鮮冷凍食品', '豬肉', '包', 'Frozen'),
    ('生鮮冷凍食品', '牛肉', '包', 'Frozen'),
    ('生鮮冷凍食品', '雞肉', '包', 'Frozen'),
    ('生鮮冷凍食品', '雞蛋(盒裝)', '盒', 'HasExpiry'),
    ('生鮮冷凍食品', '雞蛋(箱裝)', '箱', 'HasExpiry'),
    ('生鮮冷凍食品', '甜點類', '包', 'Frozen'),
    ('生鮮冷凍食品', '湯類', '包', 'Frozen'),
    ('生鮮冷凍食品', '沖泡類', '包', 'HasExpiry'),
    ('生鮮冷凍食品', '麵包類', '個', 'Frozen'),
    ('日用品', '成人紙尿布', '包', 'NoExpiry'),
    ('日用品', '尿布墊', '包', 'NoExpiry'),
    ('日用品', '棉被', '條', 'NoExpiry'),
    ('日用品', '毯子', '條', 'NoExpiry'),
    ('日用品', '床墊', '座', 'NoExpiry'),
    ('輔具', '一般輪椅', '台', 'NoExpiry'),
    ('輔具', '鐵製輪椅', '台', 'NoExpiry'),
    ('輔具', '輕便輪椅', '台', 'NoExpiry'),
    ('輔具', '高背輪椅', '台', 'NoExpiry'),
    ('輔具', '便盆椅', '座', 'NoExpiry'),
    ('輔具', '氣墊床', '床', 'NoExpiry'),
    ('輔具', '電動床', '座', 'NoExpiry'),
    ('輔具', '單拐', '隻', 'NoExpiry'),
    ('輔具', '雙枴', '隻', 'NoExpiry'),
    ('輔具', '四腳拐', '組', 'NoExpiry')
) as v(category, item_name, unit, stock_type)
where not exists (
    select 1 from inventory_item_definition d
    where d.category = v.category and d.item_name = v.item_name and d.is_active
);

-- ============================================================================
-- 物資目錄：54 個規格（掛在上面剛新增或既有的定義底下）
-- ============================================================================
insert into inventory_item_variant (inventory_item_definition_id, specification, is_active)
select d.id, v.specification, true
from (values
    ('食品', '米', '1公斤'), ('食品', '米', '3公斤'), ('食品', '米', '5公斤'), ('食品', '米', '30公斤'),
    ('食品', '水', '300ML'), ('食品', '水', '600ML'),
    ('食品', '米酒', '600ML'),
    ('食品', '食用油', '600ML'),
    ('食品', '醬油', '600ML'),
    ('食品', '飲料', '300ML'), ('食品', '飲料', '600ML'), ('食品', '飲料', '975ML'),
    ('食品', '罐頭', '八寶粥類'), ('食品', '罐頭', '魚類'), ('食品', '罐頭', '醬瓜類'),
    ('食品', '綠豆', '無'), ('食品', '鹽巴', '無'), ('食品', '冬粉', '無'),
    ('食品', '米粉', '無'), ('食品', '麵條', '無'),
    ('食品', '泡麵(袋裝)', '無'), ('食品', '泡麵(碗裝)', '無'),
    ('生鮮冷凍食品', '蔬菜', '無'), ('生鮮冷凍食品', '豬肉', '無'),
    ('生鮮冷凍食品', '牛肉', '無'), ('生鮮冷凍食品', '雞肉', '無'),
    ('生鮮冷凍食品', '雞蛋(盒裝)', '12入'), ('生鮮冷凍食品', '雞蛋(箱裝)', '無'),
    ('生鮮冷凍食品', '甜點類', '無'), ('生鮮冷凍食品', '湯類', '無'),
    ('生鮮冷凍食品', '沖泡類', '無'), ('生鮮冷凍食品', '麵包類', '無'),
    ('日用品', '成人紙尿布', 'S'), ('日用品', '成人紙尿布', 'M'),
    ('日用品', '成人紙尿布', 'L'), ('日用品', '成人紙尿布', 'XL'),
    ('日用品', '尿布墊', 'S'), ('日用品', '尿布墊', 'M'),
    ('日用品', '尿布墊', 'L'), ('日用品', '尿布墊', 'XL'),
    ('日用品', '棉被', '無'), ('日用品', '毯子', '無'),
    ('日用品', '床墊', '單人'), ('日用品', '床墊', '雙人'),
    ('輔具', '一般輪椅', '無'), ('輔具', '鐵製輪椅', '無'),
    ('輔具', '輕便輪椅', '無'), ('輔具', '高背輪椅', '無'),
    ('輔具', '便盆椅', '無'), ('輔具', '氣墊床', '無'),
    ('輔具', '電動床', '無'), ('輔具', '單拐', '無'),
    ('輔具', '雙枴', '無'), ('輔具', '四腳拐', '無')
) as v(category, item_name, specification)
join inventory_item_definition d
    on d.category = v.category and d.item_name = v.item_name and d.is_active
where not exists (
    select 1 from inventory_item_variant iv
    where iv.inventory_item_definition_id = d.id
      and iv.specification = v.specification
      and iv.is_active
);

-- ============================================================================
-- LineNotificationSettings / AIStockInSettings 單筆設定列（沒有就補一筆預設值）
-- ============================================================================
insert into line_notification_settings (is_enabled, notify_low_stock, notify_expiring_soon, notify_expired)
select false, true, true, true
where not exists (select 1 from line_notification_settings);

insert into ai_stock_in_settings (is_enabled, supports_image_input, supports_text_input)
select false, true, true
where not exists (select 1 from ai_stock_in_settings);
