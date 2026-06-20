// USAI Stage 4 — 정합(Reconcile): AI 추출 raw 레코드 → 정규화 + 형식불변 검증.
// 철학: 도메인 밴드("T4는 얼마") 금지. 여기 검사는 어떤 형식이든 참인 항진명제만:
//   ① provenance(출처 좌표) 존재  ② 가격 양수  ③ 통화/기간 해석 가능.
// 환산은 normalize-money SSOT 위임. 해석 불가/위반은 issues로 남겨 다음 단계가 needs_human 처리.
import {
  resolveCurrency, resolvePeriod, resolveGpuCount, toUsdPerGpuHour, type Period,
} from './normalize-money.ts'

export interface RawRecord {
  model_name: string
  model_addr: string
  price_raw: number | string
  price_addr: string
  currency_token: string | null
  unit_token: string | null
  gpu_count_hint?: number | null
  term?: string | null
  block_id: string
  /** Stage6 분류 결과: own_target | competitor | supplier */
  source_type?: string | null
  confidence: number
}

export interface ReconcileContext {
  krwPerUsd: number
  /** 블록 단서(헤더/제목에서 온 기본값) — 레코드에 토큰이 없을 때 폴백 */
  blockCurrency?: string | null
  blockUnit?: string | null
  blockGpuCount?: number | null
}

export interface ReconciledItem {
  model_name: string
  unit_price_usd: number
  original_price: number
  original_currency: string
  original_unit: Period
  gpu_count: number
  term: string | null
  target: string
  provenance: { model_addr: string; price_addr: string; block_id: string }
  confidence: number
  issues: string[]
}

const VALID_TARGETS = new Set(['own_target', 'competitor', 'supplier'])

/** "₩7,000,000" / "7,000,000" / 7000000 → 7000000. 통화기호·천단위콤마·공백 제거. */
export function parsePriceNumber(raw: number | string): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const cleaned = raw.replace(/[^\d.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

/** raw 레코드 1건 → 정규화 + 형식불변 검증. 항상 ReconciledItem 반환(위반은 issues에). */
export function reconcileRecord(rec: RawRecord, ctx: ReconcileContext): ReconciledItem {
  const issues: string[] = []

  // ① provenance 필수
  if (!rec.price_addr) issues.push('missing_price_provenance')
  if (!rec.model_addr) issues.push('missing_model_provenance')

  // 통화/기간/장수 해석 (레코드 → 블록 단서 폴백)
  const currency = resolveCurrency(rec.currency_token) ?? resolveCurrency(ctx.blockCurrency)
  const period = resolvePeriod(rec.unit_token) ?? resolvePeriod(ctx.blockUnit)
  const gpuCount =
    (rec.gpu_count_hint && rec.gpu_count_hint > 0 ? rec.gpu_count_hint : null) ??
    resolveGpuCount(rec.model_name) ??
    (ctx.blockGpuCount && ctx.blockGpuCount > 0 ? ctx.blockGpuCount : null) ??
    1

  if (!currency) issues.push('unknown_currency')
  if (!period) issues.push('unknown_unit')

  // ② 가격 양수
  const price = parsePriceNumber(rec.price_raw)
  if (price == null) issues.push('unparseable_price')
  else if (price <= 0) issues.push('nonpositive_price')

  // 분류 타깃 정합
  const target = rec.source_type && VALID_TARGETS.has(rec.source_type) ? rec.source_type : 'competitor'
  if (!rec.source_type || !VALID_TARGETS.has(rec.source_type)) issues.push('unclassified_target')

  let unit_price_usd = 0
  if (currency && period && price != null && price > 0) {
    try {
      unit_price_usd = toUsdPerGpuHour({ amount: price, currency, period, gpuCount, krwPerUsd: ctx.krwPerUsd })
    } catch (e) {
      issues.push(`fx_error:${e instanceof Error ? e.message : 'unknown'}`)
    }
  }

  return {
    model_name: rec.model_name?.trim() ?? '',
    unit_price_usd,
    original_price: price ?? 0,
    original_currency: currency ?? '',
    original_unit: (period ?? 'hour') as Period,
    gpu_count: gpuCount,
    term: rec.term ?? null,
    target,
    provenance: { model_addr: rec.model_addr, price_addr: rec.price_addr, block_id: rec.block_id },
    confidence: rec.confidence,
    issues,
  }
}

export function reconcileRecords(recs: RawRecord[], ctx: ReconcileContext): ReconciledItem[] {
  return recs.map((r) => reconcileRecord(r, ctx))
}
