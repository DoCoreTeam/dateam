import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'

const quoteSchema = z.object({
  items: z.array(
    z.object({
      product_id: z.string().uuid(),
      quantity: z.number().int().min(1).max(10000),
      custom_margin_pct: z.number().min(0).max(200).optional(),
    })
  ).min(1).max(50),
  currency: z.enum(['USD', 'KRW']).default('USD'),
})

export async function OPTIONS() {
  return optionsResponse()
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const parsed = quoteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: parsed.error.flatten() },
        { status: 400, headers: corsHeaders() }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { items, currency } = parsed.data

    const [settingsRes, fxRes, lowestRes, directRes] = await Promise.all([
      admin.from('pricing_settings').select('margin_pct').eq('id', 1).single(),
      admin.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
      admin.from('v_lowest_quotes').select('product_id, unit_price_usd, valid_until'),
      admin.from('direct_prices').select('product_id, sell_price_krw').eq('is_current', true),
    ])

    const defaultMargin = settingsRes.data?.margin_pct ?? 18
    const usdKrw = Number(fxRes.data?.usd_krw ?? 1400)

    const lowestMap = new Map(
      (lowestRes.data ?? []).map((q: Record<string, unknown>) => [q.product_id as string, q])
    )
    const directMap = new Map(
      (directRes.data ?? []).map((p: Record<string, unknown>) => [p.product_id as string, p])
    )

    const productIds = items.map((i) => i.product_id)
    const { data: products } = await admin
      .from('gpu_products')
      .select('id, model_name, tier, memory, gpu_count, pricing_mode')
      .in('id', productIds)

    const productMap = new Map(
      (products ?? []).map((p: Record<string, unknown>) => [p.id as string, p])
    )

    let subtotalUsd = 0
    const lineItems = items.map((item) => {
      const product = productMap.get(item.product_id) as Record<string, unknown> | undefined
      if (!product) return { ...item, error: 'Product not found' }

      const margin = item.custom_margin_pct ?? defaultMargin

      let unitPriceUsd: number | null = null
      if (product.pricing_mode === 'quote') {
        const lowest = lowestMap.get(item.product_id) as Record<string, unknown> | undefined
        const costUsd = lowest?.unit_price_usd ? Number(lowest.unit_price_usd) : null
        unitPriceUsd = costUsd ? Math.round(costUsd * (1 + margin / 100) * 100) / 100 : null
      } else {
        const direct = directMap.get(item.product_id) as Record<string, unknown> | undefined
        const krw = direct?.sell_price_krw ? Number(direct.sell_price_krw) : null
        unitPriceUsd = krw ? Math.round((krw / usdKrw) * 100) / 100 : null
      }

      const totalUsd = unitPriceUsd ? Math.round(unitPriceUsd * item.quantity * 100) / 100 : null
      if (totalUsd) subtotalUsd += totalUsd

      return {
        product_id: item.product_id,
        model_name: product.model_name,
        tier: product.tier,
        memory: product.memory,
        gpu_count: product.gpu_count,
        quantity: item.quantity,
        unit_price_usd: unitPriceUsd,
        unit_price_krw: unitPriceUsd ? Math.round(unitPriceUsd * usdKrw) : null,
        total_usd: totalUsd,
        total_krw: totalUsd ? Math.round(totalUsd * usdKrw) : null,
        margin_pct: margin,
        available: unitPriceUsd != null,
      }
    })

    const response = {
      success: true,
      data: {
        items: lineItems,
        summary: {
          subtotal_usd: Math.round(subtotalUsd * 100) / 100,
          subtotal_krw: Math.round(subtotalUsd * usdKrw),
          currency,
          ...(currency === 'KRW'
            ? { total: Math.round(subtotalUsd * usdKrw) }
            : { total: Math.round(subtotalUsd * 100) / 100 }),
          fx_usd_krw: usdKrw,
          fx_rate_date: fxRes.data?.rate_date,
          quoted_at: new Date().toISOString(),
        },
      },
    }

    return NextResponse.json(response, { headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/quote POST]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}
