import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    const [productsRes, lowestRes, directRes, settingsRes, fxRes] = await Promise.all([
      admin.from('gpu_products').select('id, model_name, tier, memory, gpu_count, vcpu, ram_gb, storage_gb, series, pricing_mode').order('tier').order('model_name'),
      admin.from('v_lowest_quotes').select('product_id, unit_price_usd, valid_until, suppliers(name)'),
      admin.from('direct_prices').select('gpu_products(id), sell_price_krw').eq('is_current', true),
      admin.from('pricing_settings').select('margin_pct').eq('id', 1).single(),
      admin.from('fx_rates').select('usd_krw').order('rate_date', { ascending: false }).limit(1).single(),
    ])

    const lowestMap = new Map(
      (lowestRes.data ?? []).map((q: Record<string, unknown>) => [q.product_id as string, q])
    )
    const directMap = new Map(
      (directRes.data ?? []).map((p: Record<string, unknown>) => [
        (p.gpu_products as Record<string, unknown>)?.id as string,
        p,
      ])
    )

    const marginPct = settingsRes.data?.margin_pct ?? 18
    const usdKrw = fxRes.data?.usd_krw ?? 1400

    const products = (productsRes.data ?? []).map((p: Record<string, unknown>) => {
      const id = p.id as string
      if (p.pricing_mode === 'quote') {
        const lowest = lowestMap.get(id) as Record<string, unknown> | undefined
        const costUsd = lowest ? Number(lowest.unit_price_usd) : null
        const priceUsd = costUsd ? Math.round(costUsd * (1 + marginPct / 100) * 100) / 100 : null
        const priceKrw = priceUsd ? Math.round(priceUsd * Number(usdKrw)) : null
        return {
          id,
          model_name: p.model_name,
          tier: p.tier,
          memory: p.memory,
          gpu_count: p.gpu_count,
          vcpu: p.vcpu,
          ram_gb: p.ram_gb,
          storage_gb: p.storage_gb,
          series: p.series,
          pricing_mode: 'dynamic',
          price_per_unit_usd: priceUsd,
          price_per_unit_krw: priceKrw,
          supplier: (lowest?.suppliers as Record<string, unknown>)?.name ?? null,
          valid_until: lowest?.valid_until ?? null,
          available: costUsd != null,
        }
      } else {
        const direct = directMap.get(id) as Record<string, unknown> | undefined
        const priceKrw = direct ? Number(direct.sell_price_krw) : null
        const priceUsd = priceKrw ? Math.round((priceKrw / Number(usdKrw)) * 100) / 100 : null
        return {
          id,
          model_name: p.model_name,
          tier: p.tier,
          memory: p.memory,
          gpu_count: p.gpu_count,
          vcpu: p.vcpu,
          ram_gb: p.ram_gb,
          storage_gb: p.storage_gb,
          series: p.series,
          pricing_mode: 'fixed',
          price_per_unit_usd: priceUsd,
          price_per_unit_krw: priceKrw,
          supplier: null,
          valid_until: null,
          available: priceKrw != null,
        }
      }
    })

    return NextResponse.json(
      {
        success: true,
        data: products,
        meta: { total: products.length, currency: 'USD', fx_usd_krw: usdKrw },
      },
      { headers: corsHeaders() }
    )
  } catch (err) {
    console.error('[public/v1/products GET]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}
