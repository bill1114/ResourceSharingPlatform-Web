// Port of SupplyDonationController.Create (POST) + SupplyDonationService.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { AuthError, assertLocationAccess, requireCaller } from '../_shared/auth.ts'

interface Body {
  supplyItemId: number
  locationId: number
  donationQuantity: number
  donorName: string
  donorContact?: string
  remark?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ctx = await requireCaller(req)
    const body = (await req.json()) as Body

    if (!body.donorName?.trim()) {
      throw new AuthError('請輸入捐贈者姓名', 400)
    }

    assertLocationAccess(ctx, body.locationId)

    const operatorName = ctx.profile.display_name ?? ctx.profile.username

    const { data, error } = await ctx.adminClient.rpc('donation_create', {
      p_supply_item_id: body.supplyItemId,
      p_location_id: body.locationId,
      p_donation_quantity: body.donationQuantity,
      p_donor_name: body.donorName.trim(),
      p_donor_contact: body.donorContact?.trim() || null,
      p_operator: operatorName,
      p_remark: body.remark?.trim() || null,
    })

    if (error) {
      throw new AuthError(error.message, 400)
    }

    ctx.adminClient.functions
      .invoke('line-notify', { body: { triggeredBy: 'donation' } })
      .catch((e: unknown) => console.error('line-notify failed', e))

    return new Response(JSON.stringify({ success: true, message: '捐贈入庫完成', log: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500
    const message = e instanceof Error ? e.message : '捐贈失敗'
    return new Response(JSON.stringify({ success: false, message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
