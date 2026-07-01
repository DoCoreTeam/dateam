// own_target(우리 목표/판매가) → 전략 판매가 반영 SSOT.
// competitor-import(saveCompetitorPrices)와 대칭. confirm 경로(review/[id])가 import해 호출.
// 정책: 약정별(term) 판매가는 gpu_product_term_prices에 term별로 저장(SSOT).
//       on_demand는 gpu_products.strategic_price_krw에도 미러(하위호환 — 기존 콕핏/가격표 계산 무변경).
//       reserved 등도 이제 term별로 저장(과거처럼 차단하지 않음). 사람 확정 게이트 뒤에서만 실행.
import { inferTier } from './tier-dict.ts'
import { normalizeMemory } from './normalize.ts'
import { normalizeTerm, isOnDemand } from './term.ts'

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
  /** 저장된 표준 term (on_demand | reserved_6m | ...) */
  term?: string
  /** 저장된 판매가 KRW (term 무관 공통). */
  price_krw?: number
  /** on_demand일 때만 — strategic_price_krw 미러값(하위호환). */
  strategic_price_krw?: number
  reason?: string
}

/**
 * own_target 확정 → 약정별 판매가 반영. db=adminClient. extracted=review_items.current_extracted.
 * 1) 모델 매칭(없으면 미반영) / 2) USD×fx KRW / 3) term별 gpu_product_term_prices upsert
 *    + on_demand는 gpu_products.strategic_price_krw 미러(하위호환) / 4) audit + revalidate.
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

  const term = normalizeTerm(extracted.term)
  const onDemand = isOnDemand(term)

  const unitPriceUsd = typeof extracted.unit_price_usd === 'number' ? extracted.unit_price_usd : Number(extracted.unit_price_usd)
  const krw = strategicKrwFromUsd(unitPriceUsd, krwPerUsd)
  if (krw === null) return { ok: false, product_id: null, reason: '판매가 환산 실패(단가/환율 비정상)' }

  // 모델 매칭 — memory 있으면 좁히고, 없으면 tier로.
  const memory = normalizeMemory(typeof extracted.memory === 'string' ? extracted.memory : null)
  const tier = inferTier(modelName)
  let q = db.from('gpu_products').select('id, model_name').is('deleted_at', null)
  q = memory ? q.eq('memory', memory) : q.eq('tier', tier)
  const { data: cands } = await q.limit(300)
  const productId = matchProductId((cands ?? []) as ProductCand[], modelName)
  if (!productId) return { ok: false, product_id: null, reason: `판매가 반영 실패 — '${modelName}' 매칭 제품 없음(콕핏에서 직접 설정 필요)` }

  const nowIso = new Date().toISOString()
  const setReason = `USAI own_target 확정 반영 (${term})`

  // 약정별 판매가 SSOT upsert — (product_id, term) 유니크.
  const { error: termErr } = await db.from('gpu_product_term_prices').upsert({
    product_id: productId, term, price_krw: krw, set_by: actor, set_reason: setReason, set_at: nowIso, updated_at: nowIso,
  }, { onConflict: 'product_id,term' })
  if (termErr) return { ok: false, product_id: productId, reason: termErr.message }

  // on_demand는 gpu_products.strategic_price_krw에도 미러(기존 콕핏/가격표 계산 하위호환).
  let mirrored: number | undefined
  if (onDemand) {
    const { data: before } = await db.from('gpu_products')
      .select('strategic_price_krw, strategic_override_reason').eq('id', productId).single()
    const { error } = await db.from('gpu_products').update({
      strategic_price_krw: krw,
      strategic_override_reason: 'USAI own_target 확정 반영',
      strategic_set_by: actor,
      strategic_set_at: nowIso,
    }).eq('id', productId).is('deleted_at', null)
    if (error) return { ok: false, product_id: productId, reason: error.message }
    mirrored = krw
    await recordAudit({
      before: { strategic_price_krw: before?.strategic_price_krw ?? null, reason: before?.strategic_override_reason ?? null },
      after: { strategic_price_krw: krw, reason: 'USAI own_target 확정 반영' },
      action: 'set', source: 'usai_own_target', term, model_name: modelName, unit_price_usd: unitPriceUsd, krw_per_usd: krwPerUsd,
    }, productId)
  } else {
    await recordAudit({
      after: { term, price_krw: krw }, action: 'set', source: 'usai_own_target_term',
      term, model_name: modelName, unit_price_usd: unitPriceUsd, krw_per_usd: krwPerUsd,
    }, productId)
  }
  revalidate()

  return { ok: true, product_id: productId, term, price_krw: krw, strategic_price_krw: mirrored }
}
