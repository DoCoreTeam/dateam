// own_target(우리 목표/판매가) → 전략가(gpu_products.strategic_price_krw) 반영 SSOT.
// competitor-import(saveCompetitorPrices)와 대칭. confirm 경로(review/[id])가 import해 호출.
// 정책: strategic_price_krw는 product당 단일 KRW(요금제 컬럼 없음) → on_demand 대표가만 반영.
//       reserved 등은 컬럼 부재로 스킵(무음 금지 — reason 반환). 사람 확정 게이트 뒤에서만 실행.
import { inferTier } from './tier-dict.ts'
import { normalizeMemory } from './normalize.ts'

// strategic-price 엔드포인트와 동일 상한(SSOT).
export const STRATEGIC_PRICE_MAX = 100_000_000_000

const GENERIC_TOK = new Set(['rtx', 'nvidia', 'gpu', 'geforce', 'quadro', 'tesla', 'sxm', 'pcie', 'ada', 'super', 'ti'])
const norm = (s: string): string => s.toLowerCase().replace(/[\s\-_]+/g, '')
const distinctiveTokens = (s: string): string[] =>
  s.toLowerCase().replace(/[_\-]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !GENERIC_TOK.has(t))

export interface ProductCand { id: string; model_name: string }

/** 모델명 매칭(SSOT) — 정규화 완전일치 → 구별토큰 양방향 일치. generic 토큰 단독 매칭 금지. 순수함수. */
export function matchProductId(candidates: ProductCand[], modelName: string): string | null {
  const targetNorm = norm(modelName)
  const exact = candidates.find((c) => norm(c.model_name) === targetNorm)
  if (exact) return exact.id
  const targetTokens = distinctiveTokens(modelName)
  if (targetTokens.length === 0) return null
  const hit = candidates.find((c) => {
    const ct = distinctiveTokens(c.model_name)
    if (ct.length === 0) return false
    return targetTokens.every((t) => ct.includes(t)) && ct.every((t) => targetTokens.includes(t))
  })
  return hit?.id ?? null
}

/** on_demand 약정만 전략가 대상(요금제 컬럼 없음). 표기차 정규화. */
export function isOnDemandTerm(term: unknown): boolean {
  const t = typeof term === 'string' ? term.toLowerCase().replace(/[\s_-]/g, '') : ''
  return t === '' || t === 'ondemand' || t === 'od'
}

/** USD/GPU/hr → 전략가 KRW(반올림). 범위 밖이면 null(차단). */
export function strategicKrwFromUsd(unitPriceUsd: number, krwPerUsd: number): number | null {
  if (!Number.isFinite(unitPriceUsd) || unitPriceUsd <= 0) return null
  if (!Number.isFinite(krwPerUsd) || krwPerUsd <= 0) return null
  const krw = Math.round(unitPriceUsd * krwPerUsd)
  if (krw <= 0 || krw > STRATEGIC_PRICE_MAX) return null
  return krw
}

export interface OwnTargetResult {
  ok: boolean
  product_id: string | null
  strategic_price_krw?: number
  reason?: string
}

/**
 * own_target 확정 → 전략가 반영. db=adminClient. extracted=review_items.current_extracted.
 * 1) on_demand만 / 2) 모델 매칭(없으면 미반영) / 3) USD×fx KRW / 4) gpu_products UPDATE + audit + revalidate.
 */
export async function saveOwnTargetAsStrategicPrice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  extracted: Record<string, unknown>,
  actor: string,
  krwPerUsd: number,
  recordAudit: (detail: Record<string, unknown>, productId: string) => Promise<void>,
  revalidate: () => void,
): Promise<OwnTargetResult> {
  const modelName = typeof extracted.model_name === 'string' ? extracted.model_name.trim() : ''
  if (!modelName) return { ok: false, product_id: null, reason: '모델명 없음' }

  if (!isOnDemandTerm(extracted.term)) {
    return { ok: false, product_id: null, reason: `전략가는 on_demand 기준만 반영됩니다(요금제별 컬럼 없음). 이 항목 약정: ${String(extracted.term)}` }
  }

  const unitPriceUsd = typeof extracted.unit_price_usd === 'number' ? extracted.unit_price_usd : Number(extracted.unit_price_usd)
  const krw = strategicKrwFromUsd(unitPriceUsd, krwPerUsd)
  if (krw === null) return { ok: false, product_id: null, reason: '전략가 환산 실패(단가/환율 비정상)' }

  // 모델 매칭 — memory 있으면 좁히고, 없으면 tier로.
  const memory = normalizeMemory(typeof extracted.memory === 'string' ? extracted.memory : null)
  const tier = inferTier(modelName)
  let q = db.from('gpu_products').select('id, model_name').is('deleted_at', null)
  q = memory ? q.eq('memory', memory) : q.eq('tier', tier)
  const { data: cands } = await q.limit(300)
  const productId = matchProductId((cands ?? []) as ProductCand[], modelName)
  if (!productId) return { ok: false, product_id: null, reason: `전략가 반영 실패 — '${modelName}' 매칭 제품 없음(콕핏에서 직접 설정 필요)` }

  const { data: before } = await db.from('gpu_products')
    .select('strategic_price_krw, strategic_override_reason').eq('id', productId).single()

  const { error } = await db.from('gpu_products').update({
    strategic_price_krw: krw,
    strategic_override_reason: 'USAI own_target 확정 반영',
    strategic_set_by: actor,
    strategic_set_at: new Date().toISOString(),
  }).eq('id', productId).is('deleted_at', null)
  if (error) return { ok: false, product_id: productId, reason: error.message }

  await recordAudit({
    before: { strategic_price_krw: before?.strategic_price_krw ?? null, reason: before?.strategic_override_reason ?? null },
    after: { strategic_price_krw: krw, reason: 'USAI own_target 확정 반영' },
    action: 'set', source: 'usai_own_target', model_name: modelName, unit_price_usd: unitPriceUsd, krw_per_usd: krwPerUsd,
  }, productId)
  revalidate()

  return { ok: true, product_id: productId, strategic_price_krw: krw }
}
