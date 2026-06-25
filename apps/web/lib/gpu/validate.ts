// AI 추출 결과 검증 게이트 (H1) — DB 쓰기 전 단일 검증(SSOT). 통합입력 저장 전 경로가 재사용.
// 정책: 같은 검증이 필요하면 새로 짜지 말고 이 모듈 import. enum/범위는 DB CHECK 제약을 미러(드리프트 테스트로 감시).
// H2 신뢰도 게이팅·H4 이상탐지(sanity)도 여기서 함께 수행.

// 통합입력 1회 처리 행 상한(SSOT) — 추출(batch)·확정(commit) 경로가 동일 상수 사용.
//  과거 두 경로가 slice(0,50)을 복붙해 미리보기(다수)↔저장(50)이 비대칭 → 50행 초과분 무음 소실(RC-D).
//  상한은 남기되(거대 페이로드 방어) 500으로 상향하고, 초과 시 truncated 카운트로 노출(무음 금지).
export const MAX_INTAKE_ITEMS = 500

// ── SSOT: DB CHECK 제약 미러 (058/052 등). 변경 시 drift 테스트가 잡음 ──
export const ENUMS = {
  pricing_model: ['on_demand', 'reserved_1y', 'reserved_3y', 'spot', 'committed'],
  tier: [1, 2, 3],
  review_status: ['pending', 'confirmed', 'rejected', 'superseded'],
  channel: ['mail', 'msg', 'pdf', 'img', 'own'],
  impact_level: ['new_model', 'price_low_change', 'big_swing', 'steady'],
} as const

// 신뢰도 게이팅(H2) 임계값
export const CONFIDENCE = { AUTO: 90, REVIEW: 60 } as const  // ≥90 자동후보 / 60~89 검토권장 / <60 저신뢰
// 이상탐지(H4) 가격 밴드 (USD/GPU·hr) — tier별 상식 범위. 밖이면 anomaly 경고(차단 아님, 플래그).
// 한 tier 안에 저가 카드(T4·RTX-A 등)와 고가 카드가 공존하므로 하한은 넉넉히 — 명백한 이상만 잡고 허위경보 방지.
// 060 DB 함수의 밴드와 동일 유지(SSOT 정합).
export const PRICE_BAND: Record<number, [number, number]> = { 1: [0.08, 150], 2: [0.03, 40], 3: [0.02, 20] }
const PRICE_HARD = { min: 0, max: 1000 }   // 이 밖은 불가능 → 차단

export type Severity = 'block' | 'warn'
export interface Issue { field: string; severity: Severity; msg: string }
export interface ValidationResult {
  ok: boolean              // block 이슈 0
  issues: Issue[]
  confidenceGate: 'auto' | 'review' | 'low' | 'none'  // H2
  priceUnknown?: boolean   // 보존: 가격 없음(block 아님, needs_review 플래그)
}

// 보존 옵션 — 가격 없는 행("Contact us" 등)을 버리지 않고 price_unknown 플래그로 통과(needs_review).
// 기본은 종전 동작(가격 없음=block) 유지 — 기존 호출처·테스트 호환.
export interface ValidateOptions { preserveNoPrice?: boolean }

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
  return Number.isFinite(n) ? n : null
}

// 공급가 추출 항목 검증 — { extracted: { model_name, memory, unit_price_usd|price_usd, term_months, supplier, tier_suggestion }, confidence }
// 보존(opts.preserveNoPrice): 가격 없는 행을 block→price_unknown(warn)으로 완화해 passed에 포함.
//  competitor 경로(validateCompetitorItem)와 동일 정책 — 미리보기(보존)↔확정(차단) 비대칭(RC-C) 제거.
//  무가격 공급가 행(확인중/Contact us)은 검토 큐에 flag로 남겨 사람이 판단(무음 소실 금지).
export function validateSupplierItem(
  item: { extracted?: Record<string, unknown>; confidence?: Record<string, number | null> },
  opts?: ValidateOptions,
): ValidationResult {
  const ex = item?.extracted ?? {}
  const issues: Issue[] = []

  // 필수: 모델명
  const model = typeof ex.model_name === 'string' ? ex.model_name.trim() : ''
  if (!model) issues.push({ field: 'model_name', severity: 'block', msg: '모델명 없음 — GPU 견적으로 식별 불가' })

  // 가격: 양수 + 하드 범위(불가능치 차단) + 밴드(이상치 경고)
  const price = num(ex.unit_price_usd ?? ex.price_usd)
  if (price === null) {
    issues.push(opts?.preserveNoPrice
      ? { field: 'price', severity: 'warn', msg: '단가 미상(확인중·Contact us) — 확인 후 반영' }
      : { field: 'price', severity: 'block', msg: '단가 없음/숫자 아님' })
  } else if (price <= PRICE_HARD.min || price > PRICE_HARD.max) issues.push({ field: 'price', severity: 'block', msg: `단가 ${price} — 불가능 범위(0<p≤${PRICE_HARD.max})` })

  // tier(있으면) enum
  const tier = num(ex.tier_suggestion ?? ex.tier)
  if (tier !== null && !ENUMS.tier.includes(tier as 1 | 2 | 3)) issues.push({ field: 'tier', severity: 'block', msg: `tier ${tier} — 허용 1·2·3 외` })

  // 이상탐지(H4): tier 밴드 밖 가격 → 경고
  if (price !== null && tier !== null && ENUMS.tier.includes(tier as 1 | 2 | 3)) {
    const band = PRICE_BAND[tier]
    if (band && (price < band[0] || price > band[1])) {
      issues.push({ field: 'price', severity: 'warn', msg: `Tier${tier} 단가 $${price} 상식밴드($${band[0]}~$${band[1]}) 밖 — 확인 권장` })
    }
  }

  return { ok: issues.every((i) => i.severity !== 'block'), issues, confidenceGate: gateFromConfidence(item.confidence) }
}

// 경쟁사 가격 항목 검증 — { competitor_name, model_name, memory, price_usd, pricing_model }
// 보존(opts.preserveNoPrice): 가격 없는 행을 block→price_unknown 플래그(warn)로 완화해 passed에 포함.
//   "가격 없음"만 완화 — 가격이 있으면 범위(>0) 검증은 그대로 유지. 모델명 필수도 유지.
export function validateCompetitorItem(
  it: { competitor_name?: unknown; model_name?: unknown; price_usd?: unknown; pricing_model?: unknown },
  opts?: ValidateOptions,
): ValidationResult {
  const issues: Issue[] = []
  let priceUnknown = false
  if (!(typeof it.competitor_name === 'string' && it.competitor_name.trim())) issues.push({ field: 'competitor_name', severity: 'block', msg: '경쟁사명 없음' })
  if (!(typeof it.model_name === 'string' && it.model_name.trim())) issues.push({ field: 'model_name', severity: 'block', msg: '모델명 없음' })
  const price = num(it.price_usd)
  if (price === null) {
    if (opts?.preserveNoPrice) {
      priceUnknown = true
      issues.push({ field: 'price_usd', severity: 'warn', msg: '가격 미상(Contact us 등) — 확인 후 반영' })
    } else {
      issues.push({ field: 'price_usd', severity: 'block', msg: '가격 없음/숫자 아님' })
    }
  } else if (price <= PRICE_HARD.min || price > PRICE_HARD.max) {
    issues.push({ field: 'price_usd', severity: 'block', msg: `가격 ${price} 불가능 범위` })
  }
  // pricing_model enum (있으면; 표기 정규화 후)
  if (it.pricing_model != null) {
    const pm = String(it.pricing_model).toLowerCase().replace(/-/g, '_')
    if (!ENUMS.pricing_model.includes(pm as typeof ENUMS.pricing_model[number])) {
      issues.push({ field: 'pricing_model', severity: 'block', msg: `pricing_model '${it.pricing_model}' — 허용 ${ENUMS.pricing_model.join('|')} 외` })
    }
  }
  return { ok: issues.every((i) => i.severity !== 'block'), issues, confidenceGate: 'none', priceUnknown }
}

// H2 신뢰도 게이팅 — confidence 평균으로 라우팅
export function gateFromConfidence(conf?: Record<string, number | null> | null): 'auto' | 'review' | 'low' | 'none' {
  if (!conf) return 'none'
  const vals = Object.values(conf).filter((v): v is number => typeof v === 'number')
  if (vals.length === 0) return 'none'
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  if (avg >= CONFIDENCE.AUTO) return 'auto'
  if (avg >= CONFIDENCE.REVIEW) return 'review'
  return 'low'
}

// 배열 검증 — block 항목 격리(분리), warn은 통과(플래그). { passed, blocked }
export function partitionValid<T>(items: T[], validate: (it: T) => ValidationResult): { passed: T[]; blocked: Array<{ item: T; issues: Issue[] }> } {
  const passed: T[] = []
  const blocked: Array<{ item: T; issues: Issue[] }> = []
  for (const it of items) {
    const r = validate(it)
    if (r.ok) passed.push(it)
    else blocked.push({ item: it, issues: r.issues.filter((i) => i.severity === 'block') })
  }
  return { passed, blocked }
}
