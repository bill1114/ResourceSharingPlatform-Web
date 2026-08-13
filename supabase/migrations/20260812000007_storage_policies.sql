-- Storage RLS：即使 bucket 標成 Public，那只影響「讀取」不受限，上傳/刪除還是要
-- 有明確的 RLS 規則才會放行（這是先前規劃裡漏寫的部分，見 migration plan §六）。

-- items bucket：任何已登入使用者都能上傳/刪除物資照片（跟 supply_item 表本身的
-- RLS 一樣，不做更細的據點限制，避免額外的 metadata join 複雜度）。
create policy "items_bucket_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'items');

create policy "items_bucket_update" on storage.objects
    for update to authenticated
    using (bucket_id = 'items');

create policy "items_bucket_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'items');

-- ai-stockin bucket：路徑第一段是 auth.uid()，只有上傳者自己能讀寫刪除自己的照片。
create policy "ai_stockin_bucket_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'ai-stockin' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "ai_stockin_bucket_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'ai-stockin' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "ai_stockin_bucket_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'ai-stockin' and (storage.foldername(name))[1] = auth.uid()::text);
