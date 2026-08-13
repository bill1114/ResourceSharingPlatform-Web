import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' }
class E extends Error { constructor(message:string,public status=400){super(message)} }
serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});try{
 const auth=req.headers.get('Authorization'); if(!auth)throw new E('缺少登入憑證',401)
 const userClient=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:auth}}})
 const {data:{user}}=await userClient.auth.getUser(); if(!user)throw new E('登入已失效',401)
 const {data:me}=await userClient.from('profiles').select('*').eq('id',user.id).single(); if(me?.role_name!=='Admin'||!me.is_active)throw new E('僅管理員可管理帳號',403)
 const body=await req.json(); const admin=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'')
 if(body.action==='bindings'){
  const {data,error}=await admin.from('line_bindings').select('*');if(error)throw new E(error.message);return Response.json({success:true,bindings:data??[]},{headers:cors})
 }
 if(body.action==='createBindCode'){
  if(!body.id)throw new E('缺少帳號識別碼');const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');const expiresAt=new Date(Date.now()+10*60*1000).toISOString();await admin.from('line_bind_codes').delete().eq('profile_id',body.id);const{error}=await admin.from('line_bind_codes').insert({code,profile_id:body.id,expires_at:expiresAt});if(error)throw new E(error.message);return Response.json({success:true,message:`綁定碼 ${code}，10 分鐘內請在 LINE 傳送「綁定 ${code}」`,code,expiresAt},{headers:cors})
 }
 if(body.action==='unbind'){
  const{error}=await admin.from('line_bindings').delete().eq('profile_id',body.id);if(error)throw new E(error.message);return Response.json({success:true,message:'已解除 LINE 綁定'},{headers:cors})
 }
 if(body.action==='create'){
  if(!body.username?.trim()||!body.password||body.password.length<6)throw new E('帳號必填，密碼至少 6 碼')
  const email=`${body.username.trim()}@local.invalid`;const{data:created,error}=await admin.auth.admin.createUser({email,password:body.password,email_confirm:true});if(error)throw new E(error.message)
  const{error:pErr}=await admin.from('profiles').insert({id:created.user.id,username:body.username.trim(),display_name:body.displayName?.trim()||null,role_name:body.roleName,location_id:body.locationId||null,is_active:body.isActive!==false});if(pErr){await admin.auth.admin.deleteUser(created.user.id);throw new E(pErr.message)}
  return Response.json({success:true,message:'帳號新增成功'},{headers:cors})
 }
 if(body.action==='update'){
  if(!body.id)throw new E('缺少帳號識別碼');if(body.id===user.id&&body.isActive===false)throw new E('無法停用目前登入中的帳號')
  if(body.roleName!=='Admin'||body.isActive===false){const{count}=await admin.from('profiles').select('*',{count:'exact',head:true}).eq('role_name','Admin').eq('is_active',true).neq('id',body.id);if(!count)throw new E('至少需要保留一位啟用中的管理員')}
  if(body.password){const{error}=await admin.auth.admin.updateUserById(body.id,{password:body.password});if(error)throw new E(error.message)}
  const{error}=await admin.from('profiles').update({display_name:body.displayName?.trim()||null,role_name:body.roleName,location_id:body.locationId||null,is_active:body.isActive,updated_at:new Date().toISOString()}).eq('id',body.id);if(error)throw new E(error.message)
  return Response.json({success:true,message:'帳號更新成功'},{headers:cors})
 }
 throw new E('無效操作')
}catch(e){return new Response(JSON.stringify({success:false,message:e instanceof Error?e.message:'操作失敗'}),{status:e instanceof E?e.status:500,headers:{...cors,'Content-Type':'application/json'}})}})
