import { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireMemberKey } from '@/lib/publicApiAuth'
import { fail, ok, serverError } from '@/lib/public-api/respond'
import { readJsonBody, INVALID_JSON_MESSAGE } from '@/lib/public-api/read-json'
import { createAdminClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'
import { z } from 'zod'

const PRODUCT_MISSING_MESSAGE = '제품을 찾을 수 없습니다.'

/** zod 원문 대신 어느 칸이 틀렸는지만 알려 준다 (예: items.0.quantity) */
function invalidInputMessage(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): string {
  const field = issues[0]?.path.map(String).join('.')
  return field ? `입력값을 확인해 주세요: ${field}` : '입력값을 확인해 주세요.'
}

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

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function POST(request: NextRequest) {
  // 견적 계산만 하고 아무것도 저장하지 않는다, 몸통이 커서 POST 일 뿐 읽기다
  const auth = await authenticatePublicApi(request, { scope: 'read' })
  if ('error' in auth) return auth.error
  // 내부 창구가 requireMemberApi 인 자료다, 외부용 api_user 키는 막는다
  const denied = requireMemberKey(auth.ctx, request)
  if (denied) return denied

  try {
    const read = await readJsonBody(request)
    if (!read.ok) return fail(400, INVALID_JSON_MESSAGE, { ctx: auth.ctx, request })
    const parsed = quoteSchema.safeParse(read.body)
    if (!parsed.success) {
      return fail(400, invalidInputMessage(parsed.error.issues), { ctx: auth.ctx, request })
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
      if (!product) return { ...item, error: PRODUCT_MISSING_MESSAGE }

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

    const data = {
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
    }

    return ok(data, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('quote POST', err, { ctx: auth.ctx, request })
  }
}
