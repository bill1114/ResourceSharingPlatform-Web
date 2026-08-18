import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
class E extends Error{constructor(message:string,public status=400){super(message)}}
serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});try{const auth=req.headers.get('Authorization');if(!auth)throw new E('缺少登入憑證',401);const c=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:auth}}});const{data:{user}}=await c.auth.getUser();if(!user)throw new E('登入已失效',401);const{data:p}=await c.from('profiles').select('*').eq('id',user.id).single();if(!p||!p.is_active)throw new E('帳號未啟用或不存在',403);const b=await req.json();if(p.role_name!=='Admin'&&p.location_id!==b.locationId)throw new E('只能在所屬據點入庫',403);const admin=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'');const{data,error}=await admin.rpc('ai_stockin_confirm',{p_log_id:b.logId,p_location_id:b.locationId,p_category:b.category,p_item_name:b.itemName,p_specification:b.specification||null,p_quantity:Number(b.quantity),p_unit:b.unit||null,p_stock_type:b.stockType,p_expiration_date:b.stockType==='NoExpiry'?null:b.expirationDate,p_safety_stock:Number(b.safetyStock)||0,p_remark:b.remark||null});if(error)throw new E(error.message);
 // 影像入庫確認後，把 ai-stockin 暫存照片搬進 items（集中管理）並掛到剛入庫的批次上。
 // 實體檔名維持 ASCII（Supabase 不收中文鍵）：aiN-數量-日期-001.副檔名，可被前端
 // itemPhotoDownloadName 解析出中文下載檔名。照片搬移失敗不影響入庫（庫存已寫入）。
 try{
  const{data:logRow}=await admin.from('ai_stock_in_log').select('input_image_path').eq('id',b.logId).single();
  const srcPath=logRow?.input_image_path;
  if(srcPath&&data&&!data.image_path){
   const{data:blob}=await admin.storage.from('ai-stockin').download(srcPath);
   if(blob){
    const ext=(srcPath.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const dateStr=new Date().toISOString().slice(0,10).replace(/-/g,'');
    const key=`ai${data.id}-${data.quantity}-${dateStr}-001.${ext}`;
    const{error:upErr}=await admin.storage.from('items').upload(key,blob,{contentType:blob.type||'image/jpeg',upsert:false});
    if(!upErr){
     await admin.from('supply_item').update({image_path:key}).eq('id',data.id);
     await admin.storage.from('ai-stockin').remove([srcPath]);
     data.image_path=key;
    }
   }
  }
 }catch(_e){/* 照片搬移失敗不影響入庫 */}
 return Response.json({success:true,message:'已確認並正式寫入庫存',item:data},{headers:cors})}catch(e){return new Response(JSON.stringify({success:false,message:e instanceof Error?e.message:'確認失敗'}),{status:e instanceof E?e.status:500,headers:{...cors,'Content-Type':'application/json'}})}})
