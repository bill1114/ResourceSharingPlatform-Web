// Port of SupplyDisposalController.Create (POST) + SupplyDisposalService.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { AuthError, assertLocationAccess, requireCaller } from '../_shared/auth.ts'

interface Body {
  supplyItemId: number
  locationId: number
  disposalQuantity: number
  reason: 'Expired' | 'Damaged' | 'Lost' | 'Other'
  remark?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ctx = await requireCaller(req)
    const body = (await req.json()) as Body

    assertLocationAccess(ctx, body.locationId)

    const operatorName = ctx.profile.display_name ?? ctx.profile.username

    const { data, error } = await ctx.adminClient.rpc('disposal_create', {
      p_supply_item_id: body.supplyItemId,
      p_location_id: body.locationId,
      p_disposal_quantity: body.disposalQuantity,
      p_reason: body.reason,
      p_operator: operatorName,
      p_remark: body.remark?.trim() || null,
    })

    if (error) {
      throw new AuthError(error.message, 400)
    }

    ctx.adminClient.functions
      .invoke('line-notify', { body: { triggeredBy: 'disposal' } })
      .catch((e: unknown) => console.error('line-notify failed', e))

    return new Response(JSON.stringify({ success: true, message: '報廢登記完成', log: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500
    const message = e instanceof Error ? e.message : '報廢失敗'
    return new Response(JSON.stringify({ success: false, message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
