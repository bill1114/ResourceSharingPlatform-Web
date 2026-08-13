// Self-contained for Supabase Dashboard "Via Editor" deployment.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
class AppError extends Error { constructor(message: string, public status = 403) { super(message) } }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) throw new AppError('缺少登入憑證', 401)
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new AppError('登入已失效，請重新登入', 401)
    const { data: profile } = await client.from('profiles').select('*').eq('id', user.id).single()
    if (!profile || !profile.is_active) throw new AppError('找不到有效的使用者資料', 401)
    const { logId } = await req.json() as { logId: number }
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: log } = await admin.from('supply_transfer_log').select('to_location_id,status').eq('id', logId).single()
    if (!log) throw new AppError('找不到轉移紀錄', 404)
    if (profile.role_name !== 'Admin' && profile.location_id !== log.to_location_id) throw new AppError('僅目標據點人員或管理員可取消轉移')
    const cancelledBy = profile.display_name ?? profile.username
    const { data, error } = await admin.rpc('transfer_cancel', { p_log_id: logId, p_cancelled_by: cancelledBy })
    if (error) throw new AppError(error.message, 400)
    return new Response(JSON.stringify({ success: true, message: '轉移已取消，來源據點庫存已退回', log: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: e instanceof Error ? e.message : '取消失敗' }), { status: e instanceof AppError ? e.status : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
