import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    // SSOT: 내부 화면과 동일한 buildCatalog(getGpuCatalog) 결과를 사용한다.
    //   (실견적우선·1장당전파·채택우선·공시가폴백·전략가 모두 반영 — 외부가 = 내부가)
    //   v_lowest_quotes 자체계산 폐기.
    const catalog = await getGpuCatalog(admin)
    const usdKrw = catalog.usd_krw

    const products = catalog.products.map((p) => {
      // 우리 판매가 = 전략가(strategic_krw = strategic_price_krw ?? 자동마진가). 내부 "우리 판매가"와 동일.
      const priceKrw = p.strategic_krw
      const priceUsd = priceKrw != null ? Math.round((priceKrw / usdKrw) * 100) / 100 : null
      return {
        id: p.id,
        model_name: p.model_name,
        tier: p.tier,
        memory: p.memory,
        gpu_count: p.gpu_count,
        vcpu: p.vcpu,
        ram_gb: p.ram_gb,
        storage_gb: p.storage_gb,
        series: p.series,
        pricing_mode: p.pricing_mode === 'direct' ? 'fixed' : 'dynamic',
        price_per_unit_usd: priceUsd,
        price_per_unit_krw: priceKrw,
        supplier: p.effective_supplier?.name ?? p.own_supplier?.name ?? null,
        valid_until: p.own_valid_until ?? null,
        available: priceKrw != null,
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
