// Shared helper for every Edge Function that needs to know who's calling and
// what role/location they have, before doing a service-role write. Mirrors
// the permission checks that used to live in each C# Controller
// (GetMyLocationIdIfRestricted / [Authorize(Roles=...)]).
//
// REFERENCE ONLY: the Supabase Dashboard's browser-based "Via Editor" deploy
// flow used for this project only supports pasting one self-contained file
// per function, so the actually-deployed functions (outbound-create,
// donation-create, disposal-create, ...) each inline a copy of this code
// rather than importing it. Keep this file as the source of truth to copy
// from / diff against when adding new functions or fixing a bug here -
// remember to propagate any fix to every function that inlined it.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface CallerProfile {
  id: string
  username: string
  display_name: string | null
  role_name: 'Admin' | 'Cadre' | 'SocialWorker'
  location_id: number | null
  is_active: boolean
}

export interface AuthContext {
  profile: CallerProfile
  adminClient: SupabaseClient
  isAdmin: boolean
}

export class AuthError extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.status = status
  }
}

// Verifies the request's JWT, loads the caller's profile, and returns a
// service-role client for the actual write (RLS on supply_transfer_log etc.
// intentionally grants no client-side INSERT, so the write itself has to
// bypass RLS here — after this function has already done its own check).
export async function requireCaller(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new AuthError('缺少登入憑證', 401)
  }

  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const {
    data: { user },
  } = await callerClient.auth.getUser()
  if (!user) {
    throw new AuthError('登入已失效，請重新登入', 401)
  }

  const { data: profile, error } = await callerClient.from('profiles').select('*').eq('id', user.id).single()
  if (error || !profile) {
    throw new AuthError('找不到使用者資料', 401)
  }
  if (!profile.is_active) {
    throw new AuthError('帳號已停用', 403)
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  return { profile: profile as CallerProfile, adminClient, isAdmin: profile.role_name === 'Admin' }
}

// Mirrors GetMyLocationIdIfRestricted's NoAccessSentinel behavior: Admin can
// act on any location; everyone else must act on their own assigned
// location, and a caller with no location assigned at all is rejected
// outright (never silently a no-op).
export function assertLocationAccess(ctx: AuthContext, locationId: number) {
  if (ctx.isAdmin) return
  if (ctx.profile.location_id == null) {
    throw new AuthError('您的帳號尚未指定所屬據點，無法執行此操作', 403)
  }
  if (ctx.profile.location_id !== locationId) {
    throw new AuthError('您沒有權限在此據點執行此操作', 403)
  }
}
