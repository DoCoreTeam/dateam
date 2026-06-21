// 과금구조(설치비+월과금) SSOT — AI 추출 힌트 + 파싱/정규화.
// "설치비 따로 + 월 단가 따로"를 손실 없이 저장하기 위한 공용 로직(복붙 금지).

export type BillingModel = 'hourly' | 'monthly' | 'one_time_plus_monthly'

// AI 추출 프롬프트에 덧붙이는 지시(추출 라우트·재분석 라우트 공통 append).
export const BILLING_EXTRACT_HINT = `

【과금구조 추출 — 설치비/월과금 분리】
견적에 "설치비(설치/셋업/초기비용, 1회성)"와 "월 이용료(월정액)"가 따로 있으면 각각 분리해 추출하세요. 환산하지 말고 원본 금액(KRW) 그대로:
- setup_fee_krw: 일회성 설치비(KRW 숫자). 없으면 생략.
- monthly_price_krw: 월 정기 단가(KRW 숫자, 원본 보존). 없으면 생략.
- billing_model: "one_time_plus_monthly"(설치비+월) | "monthly"(월정액만) | "hourly"(시간당). 판단 가능할 때만.
unit_price_usd(1장·시간당)는 기존 규칙대로 계속 산출하세요(월정액이면 시간 환산). 설치비는 시간당으로 섞지 말고 setup_fee_krw로만 보존하세요.`

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[,\s₩원]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export interface ParsedBilling {
  setupFeeKrw: number | null
  monthlyPriceKrw: number | null
  billingModel: BillingModel | null
  /** one_time_plus_monthly 여부 — 분리 표시 트리거 */
  hasSeparateSetup: boolean
}

/**
 * 추출 레코드에서 과금구조 필드를 파싱·정규화.
 * billing_model이 명시 없으면 설치비/월단가 유무로 추론.
 */
export function parseBilling(extracted: Record<string, unknown> | null | undefined): ParsedBilling {
  const ex = extracted ?? {}
  const setupFeeKrw = toNum(ex.setup_fee_krw)
  const monthlyPriceKrw = toNum(ex.monthly_price_krw)

  const raw = typeof ex.billing_model === 'string' ? ex.billing_model.trim() : ''
  let billingModel: BillingModel | null = null
  if (raw === 'hourly' || raw === 'monthly' || raw === 'one_time_plus_monthly') {
    billingModel = raw
  } else {
    // 추론: 설치비+월 → one_time_plus_monthly / 월만 → monthly / 둘 다 없음 → null(hourly 취급)
    if (setupFeeKrw != null && monthlyPriceKrw != null) billingModel = 'one_time_plus_monthly'
    else if (setupFeeKrw != null) billingModel = 'one_time_plus_monthly'
    else if (monthlyPriceKrw != null) billingModel = 'monthly'
  }

  return {
    setupFeeKrw,
    monthlyPriceKrw,
    billingModel,
    hasSeparateSetup: setupFeeKrw != null,
  }
}
