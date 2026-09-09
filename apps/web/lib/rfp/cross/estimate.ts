/**
 * 교차검증 권장과 비용 예상 (설계서 3.6.5)
 *
 * ## 왜 「권장」을 계산하나
 *
 * 교차검증은 비싸다 — 벤더 셋이면 비용이 셋이다. 그렇다고 안 하면
 * **틀린 금액으로 제안서를 쓴다.** 그래서 «틀렸을 때 얼마나 손해인가» 와
 * «지금 얼마나 불확실한가» 를 곱해 권할지 정한다.
 *
 * 사업 금액이 틀리면 제안 가격이 통째로 틀리고(손실 큼), 배경 설명이 조금 달라도
 * 아무 일도 안 난다(손실 작음). 같은 불확실성이라도 권할 이유가 다르다.
 */

/** 이 값이 틀렸을 때 손해가 얼마나 큰가 */
export type Stakes = 'high' | 'medium' | 'low'

export const STAKES_WEIGHT: Record<Stakes, number> = { high: 3, medium: 2, low: 1 }

/** 필드별 오판 손실 등급 — 관리자가 DB 에서 고친다. 여기는 기본값이다 */
export const DEFAULT_STAKES: Record<string, Stakes> = {
  'budget.totalAmount': 'high',
  'budget.vatIncluded': 'high',
  'schedule.proposalDeadline': 'high',
  'constraints.eligibility': 'high',
  'evaluation.technicalWeight': 'medium',
  'evaluation.priceWeight': 'medium',
  'schedule.durationMonths': 'medium',
  'scope.deliverables': 'medium',
  'overview.background': 'low',
  'overview.purpose': 'low',
}

export function stakesOf(fieldPath: string, overrides: Readonly<Record<string, Stakes>> = {}): Stakes {
  return overrides[fieldPath] ?? DEFAULT_STAKES[fieldPath] ?? 'medium'
}

export interface UncertaintyInput {
  /** 0~1. 모델이 말한 확신 */
  confidence: number | null
  /** 근거가 원문에서 확인됐나 */
  grounded: boolean
  /** 규칙 검증이 이 필드를 짚었나 */
  ruleFlagged: boolean
  /** 원문에 서로 다른 값이 여러 곳 있나 */
  conflictingMentions: number
}

/**
 * 지금 얼마나 불확실한가 0~1.
 *
 * 확신이 없다는 것과 근거가 없다는 것은 **다른 신호**다.
 * 모델이 자신 있게 지어낸 값이 가장 위험하다 — 그래서 근거 없음을 더 무겁게 본다.
 */
export function uncertainty(u: UncertaintyInput): number {
  let score = 0
  score += u.confidence === null ? 0.3 : (1 - clamp01(u.confidence)) * 0.3
  // 모델이 자신 있게 지어낸 값이 가장 위험하다
  score += u.grounded ? 0 : 0.4
  score += u.ruleFlagged ? 0.2 : 0
  score += Math.min(0.1, u.conflictingMentions * 0.05)
  return Math.min(1, score)
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

/** 이 점수를 넘으면 화면에 「교차검증 권장」 배지가 붙는다 */
export const RECOMMEND_THRESHOLD = 1.2

export interface Recommendation {
  fieldPath: string
  score: number
  recommended: boolean
  stakes: Stakes
  uncertainty: number
}

/** 권장 점수 = 오판 손실 등급 × 불확실성 */
export function recommend(
  fieldPath: string,
  u: UncertaintyInput,
  overrides: Readonly<Record<string, Stakes>> = {},
): Recommendation {
  const stakes = stakesOf(fieldPath, overrides)
  const unc = uncertainty(u)
  const score = STAKES_WEIGHT[stakes] * unc
  return { fieldPath, score: Math.round(score * 100) / 100, recommended: score >= RECOMMEND_THRESHOLD, stakes, uncertainty: unc }
}

export interface CrossCostInput {
  /** 검증할 필드 수 */
  fieldCount: number
  /** 벤더 수 */
  vendorCount: number
  /** 필드 하나를 한 벤더에 물을 때 드는 평균 원 */
  krwPerFieldPerVendor: number
  secondsPerVendor: number
}

export interface CrossEstimate {
  krw: number
  seconds: number
  calls: number
}

/**
 * 얼마나 들지 미리 보여 준다.
 *
 * 「확인」을 누르기 전에 숫자를 보여 주지 않으면 청구서를 보고 나서야 안다.
 * 벤더는 **동시에** 부르므로 시간은 곱이 아니라 가장 느린 하나다.
 */
export function estimateCross(input: CrossCostInput): CrossEstimate {
  const calls = Math.max(0, input.fieldCount) * Math.max(0, input.vendorCount)
  return {
    krw: Math.round(calls * input.krwPerFieldPerVendor),
    seconds: input.vendorCount > 0 ? Math.round(input.secondsPerVendor) : 0,
    calls,
  }
}

/** 권장 필드만 골라 예상 비용을 낸다 — 전부 검증하면 비용이 벤더 수만큼 곱해진다 */
export function planCross(
  recommendations: readonly Recommendation[],
  vendorCount: number,
  rate: { krwPerFieldPerVendor: number; secondsPerVendor: number },
): { fields: string[]; estimate: CrossEstimate } {
  const fields = recommendations.filter((r) => r.recommended).map((r) => r.fieldPath)
  return {
    fields,
    estimate: estimateCross({ fieldCount: fields.length, vendorCount, ...rate }),
  }
}
