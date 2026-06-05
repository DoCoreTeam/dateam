// 추출 항목 중복 제거 — 단일 구현(SSOT). 통합입력의 공급가·경쟁사·저장(commit) 전 경로가 이걸 재사용.
// 정책: 유관 시스템에 동일 처리가 필요하면 새로 짜지 말고 이 모듈을 import해 쓸 것.
// dedup 키: 모델+메모리+가격+약정(공급가) / 경쟁사는 +pricing_model. 키가 다르면 별건으로 보존(정보 손실 방지).
import { normalizeMemory } from './normalize'

// 값 정규화 — 대소문자·공백·표기 흔들림 흡수해 같은 항목을 같은 키로
function normName(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase().replace(/\s+/g, ' ').trim() : ''
}
function normNum(v: unknown): string {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
  return Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : ''
}
function normMem(v: unknown): string {
  return (normalizeMemory(typeof v === 'string' ? v : (v == null ? null : String(v))) ?? '').toLowerCase()
}
// 약정 정규화 — "3개월"·"3"·3·"3 months" → "3" (월수 추출). 숫자 없으면 원문 소문자.
function normTerm(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'string') {
    const m = v.match(/\d+/)
    return m ? m[0] : normName(v)
  }
  return ''
}

// 공급가 추출 항목: { extracted: { model_name, memory, unit_price_usd|price_usd, term_months|term, supplier } }
export interface SupplierLike { extracted?: Record<string, unknown> }
export function supplierKey(it: SupplierLike): string {
  const ex = it?.extracted ?? {}
  const model = normName(ex.model_name)
  if (!model) return ''   // 모델명(핵심 식별자) 없으면 식별 불가 → dedup 제외(보존)
  const price = ex.unit_price_usd ?? ex.price_usd
  // 약정: term_months(숫자)·term(문자) 혼용 → 숫자로 통일 후 비교(3 == "3개월" 흡수)
  const term = ex.term_months ?? ex.term
  return [model, normMem(ex.memory), normNum(price), normTerm(term), normName(ex.supplier)].join('|')
}

// 경쟁사 가격 항목: { competitor_name, model_name, memory, price_usd, pricing_model }
export interface CompetitorLike { competitor_name?: unknown; model_name?: unknown; memory?: unknown; price_usd?: unknown; pricing_model?: unknown }
export function competitorKey(it: CompetitorLike): string {
  const model = normName(it.model_name)
  if (!model) return ''   // 모델명 없으면 보존
  return [normName(it.competitor_name), model, normMem(it.memory), normNum(it.price_usd), normName(it.pricing_model)].join('|')
}

// 제네릭 dedup — keyOf로 키를 뽑아 첫 등장만 유지(순서 보존). 빈 키(모델 미상)는 dedup 대상에서 제외.
export function dedupBy<T>(items: T[], keyOf: (it: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    const k = keyOf(it)
    if (k.replace(/\|/g, '').trim() === '') { out.push(it); continue } // 키 비면 식별 불가 → 보존
    if (seen.has(k)) continue
    seen.add(k); out.push(it)
  }
  return out
}

export function dedupSupplier<T extends SupplierLike>(items: T[]): T[] {
  return dedupBy(items, supplierKey)
}
export function dedupCompetitor<T extends CompetitorLike>(items: T[]): T[] {
  return dedupBy(items, competitorKey)
}
