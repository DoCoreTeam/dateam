import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'

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

    // SSOT: 내부와 동일한 buildCatalog 결과에서 해당 제품을 찾는다(자체계산 폐기).
    const [catalog, fxRes] = await Promise.all([
      getGpuCatalog(admin),
      admin.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
    ])
    const p = catalog.products.find((x) => x.id === id)

    if (!p) {
      return NextResponse.json(
        { success: false, error: 'Product not found' },
        { status: 404, headers: corsHeaders() }
      )
    }

    const usdKrw = catalog.usd_krw
    const priceKrw = p.strategic_krw
    const priceUsd = priceKrw != null ? Math.round((priceKrw / usdKrw) * 100) / 100 : null

    const pricing: Record<string, unknown> =
      p.pricing_mode === 'direct'
        ? {
            pricing_mode: 'fixed',
            price_per_unit_usd: priceUsd,
            price_per_unit_krw: priceKrw,
            margin_pct: null,
            supplier: null,
            valid_until: null,
          }
        : {
            pricing_mode: 'dynamic',
            cost_usd: p.effective_unit_price_usd,
            price_per_unit_usd: priceUsd,
            price_per_unit_krw: priceKrw,
            margin_pct: catalog.margin_pct,
            supplier: p.effective_supplier ?? p.own_supplier ?? null,
            valid_until: p.own_valid_until ?? null,
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
          available: priceKrw != null,
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
