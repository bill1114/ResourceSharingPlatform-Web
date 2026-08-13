// Port of SupplyOutboundController.Create (POST) + SupplyOutboundService.IssueAsync.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { AuthError, assertLocationAccess, requireCaller } from '../_shared/auth.ts'

interface Body {
  supplyItemId: number
  locationId: number
  outboundQuantity: number
  recipientName: string
  recipientContact?: string
  remark?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ctx = await requireCaller(req)
    const body = (await req.json()) as Body

    if (!body.recipientName?.trim()) {
      throw new AuthError('請輸入領用人姓名', 400)
    }

    assertLocationAccess(ctx, body.locationId)

    const operatorName = ctx.profile.display_name ?? ctx.profile.username

    const { data, error } = await ctx.adminClient.rpc('outbound_create', {
      p_supply_item_id: body.supplyItemId,
      p_location_id: body.locationId,
      p_outbound_quantity: body.outboundQuantity,
      p_recipient_name: body.recipientName.trim(),
      p_recipient_contact: body.recipientContact?.trim() || null,
      p_operator: operatorName,
      p_remark: body.remark?.trim() || null,
    })

    if (error) {
      throw new AuthError(error.message, 400)
    }

    // Fire-and-forget: passive LINE notification, only if a stock-mutating
    // op actually succeeded. Never blocks/fails the outbound response itself.
    ctx.adminClient.functions
      .invoke('line-notify', { body: { triggeredBy: 'outbound' } })
      .catch((e: unknown) => console.error('line-notify failed', e))

    return new Response(JSON.stringify({ success: true, message: '出庫完成', log: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500
    const message = e instanceof Error ? e.message : '出庫失敗'
    return new Response(JSON.stringify({ success: false, message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
