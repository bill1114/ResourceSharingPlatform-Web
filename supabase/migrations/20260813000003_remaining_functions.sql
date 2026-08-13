create or replace function ai_stockin_confirm(
 p_log_id integer, p_location_id integer, p_category text, p_item_name text,
 p_specification text, p_quantity integer, p_unit text, p_stock_type text,
 p_expiration_date date, p_safety_stock integer, p_remark text
) returns supply_item language plpgsql security definer set search_path=public as $$
declare v_log ai_stock_in_log; v_item supply_item;
begin
 if p_quantity<=0 then raise exception '入庫數量必須大於 0'; end if;
 if p_stock_type not in ('NoExpiry','HasExpiry','Frozen') then raise exception '庫存分類錯誤'; end if;
 if p_stock_type in ('HasExpiry','Frozen') and p_expiration_date is null then raise exception '此分類必須填寫有效期限'; end if;
 select * into v_log from ai_stock_in_log where id=p_log_id and not is_confirmed for update;
 if not found then raise exception '找不到待確認紀錄，可能已處理過'; end if;
 select * into v_item from supply_item where is_active and location_id=p_location_id and category=p_category and item_name=p_item_name and specification is not distinct from p_specification and stock_type=p_stock_type and expiration_date is not distinct from p_expiration_date order by id limit 1 for update;
 if found then update supply_item set quantity=quantity+p_quantity,updated_at=now() where id=v_item.id returning * into v_item;
 else insert into supply_item(category,item_name,specification,quantity,unit,stock_type,expiration_date,location_id,safety_stock,remark,is_active) values(p_category,p_item_name,p_specification,p_quantity,p_unit,p_stock_type,case when p_stock_type='NoExpiry' then null else p_expiration_date end,p_location_id,greatest(p_safety_stock,0),p_remark,true) returning * into v_item; end if;
 update ai_stock_in_log set is_confirmed=true,confirmed_supply_item_id=v_item.id,confirmed_at=now() where id=p_log_id;
 return v_item;
end $$;
revoke execute on function ai_stockin_confirm from public,anon,authenticated;
grant execute on function ai_stockin_confirm to service_role;
