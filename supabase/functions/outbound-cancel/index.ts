// 取消一筆出庫紀錄（單一物資品項），把數量退回原本的庫存批次。
// Self-contained for Supabase Dashboard "Via Editor" deployment —— 身分驗證的
// 程式碼是各 function 各複製一份的（見 Markdown/Architecture.md §五-2），
// 這支照抄 transfer-cancel 的寫法，只換掉資料表與權限判斷的欄位。
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

    const { logId, reason } = await req.json() as { logId: number; reason?: string }
    if (!logId) throw new AppError('缺少要取消的出庫紀錄編號', 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: log } = await admin.from('supply_outbound_log').select('location_id,is_cancelled').eq('id', logId).single()
    if (!log) throw new AppError('找不到出庫紀錄', 404)
    if (log.is_cancelled) throw new AppError('這筆出庫紀錄已經取消過了', 400)
    // 比照 transfer-cancel：管理員不限據點，其他人只能取消自己據點發出去的。
    if (profile.role_name !== 'Admin' && profile.location_id !== log.location_id) throw new AppError('僅該據點人員或管理員可取消出庫')

    const cancelledBy = profile.display_name ?? profile.username
    const { data, error } = await admin.rpc('outbound_cancel', { p_log_id: logId, p_cancelled_by: cancelledBy, p_reason: reason ?? null })
    if (error) throw new AppError(error.message, 400)

    admin.functions.invoke('line-notify', { body: { triggeredBy: 'outbound' } }).catch((e: unknown) => console.error('line-notify failed', e))

    return new Response(JSON.stringify({ success: true, message: '已取消這筆出庫，庫存已退回', log: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: e instanceof Error ? e.message : '取消失敗' }), { status: e instanceof AppError ? e.status : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

