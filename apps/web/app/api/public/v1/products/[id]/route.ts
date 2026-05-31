import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { id } = params

    const [productRes, lowestRes, directRes, settingsRes, fxRes] = await Promise.all([
      admin.from('gpu_products').select('id, model_name, tier, memory, gpu_count, vcpu, ram_gb, storage_gb, series, pricing_mode').eq('id', id).single(),
      admin.from('v_lowest_quotes').select('product_id, unit_price_usd, valid_until, suppliers(name, color)').eq('product_id', id).single(),
      admin.from('direct_prices').select('sell_price_krw').eq('is_current', true).eq('product_id', id).single(),
      admin.from('pricing_settings').select('margin_pct').eq('id', 1).single(),
      admin.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
    ])

    if (!productRes.data) {
      return NextResponse.json(
        { success: false, error: 'Product not found' },
        { status: 404, headers: corsHeaders() }
      )
    }

    const p = productRes.data
    const marginPct = settingsRes.data?.margin_pct ?? 18
    const usdKrw = fxRes.data?.usd_krw ?? 1400

    let pricing: Record<string, unknown>
    if (p.pricing_mode === 'quote') {
      const lowest = lowestRes.data
      const costUsd = lowest?.unit_price_usd ? Number(lowest.unit_price_usd) : null
      const priceUsd = costUsd ? Math.round(costUsd * (1 + marginPct / 100) * 100) / 100 : null
      pricing = {
        pricing_mode: 'dynamic',
        cost_usd: costUsd,
        price_per_unit_usd: priceUsd,
        price_per_unit_krw: priceUsd ? Math.round(priceUsd * usdKrw) : null,
        margin_pct: marginPct,
        supplier: lowest?.suppliers ?? null,
        valid_until: lowest?.valid_until ?? null,
      }
    } else {
      const direct = directRes.data
      const priceKrw = direct?.sell_price_krw ? Number(direct.sell_price_krw) : null
      pricing = {
        pricing_mode: 'fixed',
        price_per_unit_usd: priceKrw ? Math.round((priceKrw / usdKrw) * 100) / 100 : null,
        price_per_unit_krw: priceKrw,
        margin_pct: null,
        supplier: null,
        valid_until: null,
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id: p.id,
          model_name: p.model_name,
          tier: p.tier,
          memory: p.memory,
          gpu_count: p.gpu_count,
          vcpu: p.vcpu,
          ram_gb: p.ram_gb,
          storage_gb: p.storage_gb,
          series: p.series,
          available: (pricing.price_per_unit_usd as number | null) != null,
          fx_usd_krw: usdKrw,
          fx_rate_date: fxRes.data?.rate_date,
          ...pricing,
        },
      },
      { headers: corsHeaders() }
    )
  } catch (err) {
    console.error('[public/v1/products/[id] GET]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}
