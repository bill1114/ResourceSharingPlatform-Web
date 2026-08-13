// Self-contained for Supabase Dashboard "Via Editor" deployment.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
type Profile = { username: string; display_name: string | null; role_name: 'Admin' | 'Cadre' | 'SocialWorker'; location_id: number | null; is_active: boolean }
class AppError extends Error { constructor(message: string, public status = 403) { super(message) } }

async function caller(req: Request): Promise<{ profile: Profile; admin: SupabaseClient }> {
  const authorization = req.headers.get('Authorization')
  if (!authorization) throw new AppError('缺少登入憑證', 401)
  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new AppError('登入已失效，請重新登入', 401)
  const { data: profile } = await client.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) throw new AppError('找不到使用者資料', 401)
  if (!profile.is_active) throw new AppError('帳號已停用')
  return { profile: profile as Profile, admin: createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '') }
}

type Line = { supplyItemId: number; transferQuantity: number }
type Body = { fromLocationId: number; toLocationId: number; lines: Line[]; remark?: string }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { profile, admin } = await caller(req)
    if (profile.role_name === 'SocialWorker') throw new AppError('僅管理員或幹部可建立物資轉移')
    const body = await req.json() as Body
    if (!Number.isInteger(body.fromLocationId) || !Number.isInteger(body.toLocationId)) throw new AppError('請選擇來源與目標據點', 400)
    if (profile.role_name !== 'Admin') {
      if (profile.location_id == null) throw new AppError('您的帳號尚未指定所屬據點，無法執行此操作')
      if (profile.location_id !== body.fromLocationId) throw new AppError('您只能從所屬據點建立轉移')
    }
    const operator = profile.display_name ?? profile.username
    const { data, error } = await admin.rpc('transfer_create', {
      p_from_location_id: body.fromLocationId, p_to_location_id: body.toLocationId,
      p_lines: body.lines, p_operator: operator, p_remark: body.remark?.trim() || null,
    })
    if (error) throw new AppError(error.message, 400)
    return new Response(JSON.stringify({ success: true, message: `轉移已建立，共 ${data?.length ?? 0} 項物資，待目標據點確認送達`, logs: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: e instanceof Error ? e.message : '轉移失敗' }), { status: e instanceof AppError ? e.status : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
