import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'
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

    // SSOT: 내부와 동일한 buildCatalog 결과를 사용. 기본가 = 전략가(우리 판매가).
    //   custom_margin_pct가 오면 그 파트너 한정으로 공급원가×(1+마진) 재계산(명시 오버라이드 보존).
    const [catalog, fxRes] = await Promise.all([
      getGpuCatalog(admin),
      admin.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
    ])

    const defaultMargin = catalog.margin_pct
    const usdKrw = catalog.usd_krw

    const productMap = new Map(catalog.products.map((p) => [p.id, p]))

    let subtotalUsd = 0
    const lineItems = items.map((item) => {
      const product = productMap.get(item.product_id)
      if (!product) return { ...item, error: 'Product not found' }

      const hasCustom = item.custom_margin_pct != null
      const margin = item.custom_margin_pct ?? defaultMargin

      let unitPriceUsd: number | null = null
      let unitPriceKrw: number | null = null
      if (hasCustom && product.effective_unit_price_usd != null) {
        // 파트너 지정 마진 — 공급원가 기준 재계산
        unitPriceUsd = Math.round(product.effective_unit_price_usd * (1 + margin / 100) * 100) / 100
        unitPriceKrw = Math.round(unitPriceUsd * usdKrw)
      } else {
        // 기본 = 우리 판매가(전략가). 내부 화면과 동일.
        unitPriceKrw = product.strategic_krw
        unitPriceUsd = unitPriceKrw != null ? Math.round((unitPriceKrw / usdKrw) * 100) / 100 : null
      }

      const totalUsd = unitPriceUsd != null ? Math.round(unitPriceUsd * item.quantity * 100) / 100 : null
      if (totalUsd) subtotalUsd += totalUsd

      return {
        product_id: item.product_id,
        model_name: product.model_name,
        tier: product.tier,
        memory: product.memory,
        gpu_count: product.gpu_count,
        quantity: item.quantity,
        unit_price_usd: unitPriceUsd,
        unit_price_krw: unitPriceKrw,
        total_usd: totalUsd,
        total_krw: totalUsd != null ? Math.round(totalUsd * usdKrw) : null,
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
