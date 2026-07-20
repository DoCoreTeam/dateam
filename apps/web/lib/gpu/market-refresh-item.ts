// market/refresh(자동 시세 수집) 경로 전용 순수 변환 — AI 원본 보고(amount/currency/pricing_unit/gpu_count)를
//   CompetitorPriceItem(obs+price_usd)으로 조립한다. 산술은 100% 여기(코드)가 한다 — AI는 원본 값만 보고.
//   SSOT 재사용: 시간계수=hours.ts, 통화환산=normalize-money.ts, 세그먼트판정=observation-classify.ts.
//   review/stream route의 reconstructPivot 분기와 동일 정책(±720/730 이원화·USD 둔갑 사고 재발 방지).
import { resolveCurrency, resolvePeriod, resolveGpuCount, amountToKrw, type FxKrwMap, type Period } from './normalize-money.ts'
import { HOURS_PER_PERIOD } from './hours.ts'
import { classifyObservation } from './observation-classify.ts'
import type { CompetitorPriceItem } from './competitor-import.ts'
import type { ComponentKind, ComponentUnit, PriceComponent, TaxBasis } from './price-components.ts'

// AI가 보고하는 원본(가공 없음) 형태 — market/refresh CLASSIFY_PROMPT의 JSON 스키마와 1:1.
export interface RawMarketRefreshItem {
  competitor_name?: unknown
  model_name?: unknown
  memory?: unknown
  amount?: unknown          // 원문 그대로의 금액(콤마 제거 숫자). 분/시/일/월/년 등 원본 청구주기 기준 총액.
  currency?: unknown        // ISO 코드 또는 기호(자유 표기) — resolveCurrency로 확정
  pricing_unit?: unknown    // "hour"|"day"|"month"|"year" 등 자유 표기 — resolvePeriod로 확정
  gpu_count?: unknown       // 이 금액이 포함하는 GPU 장수(명시 없으면 1)
  pricing_model?: unknown   // "on-demand"|"reserved-1y"|"reserved-3y"|"spot"
  notes?: unknown
  context?: unknown         // 원문 근거 문구(라벨+숫자+단위) — 세그먼트/장수 보조판정용
  components?: unknown      // 복합요금 성분(선택) — RawMarketRefreshComponent[]
}

export interface RawMarketRefreshComponent {
  component_kind?: unknown
  amount?: unknown
  currency?: unknown
  unit?: unknown
  gpu_count?: unknown
  tax_basis?: unknown
  provenance?: unknown
}

const COMPONENT_KINDS = new Set<ComponentKind>(['base_fee', 'usage', 'storage', 'flat'])
const COMPONENT_UNITS = new Set<ComponentUnit>(['minute', 'hour', 'day', 'week', 'month', 'year', 'per_gb', 'per_account'])
const TAX_BASES = new Set<TaxBasis>(['tax_excluded', 'tax_included', 'unknown'])

/** 복합요금 성분 배열 정규화 — 필수필드(kind/amount/currency/unit) 불완전 성분은 스킵(무손실이 아니라 불명확 폐기). */
export function sanitizeMarketRefreshComponents(
  raw: unknown,
  fallbackProvenance: string,
): PriceComponent[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: PriceComponent[] = []
  for (const c of raw as RawMarketRefreshComponent[]) {
    if (!c || typeof c !== 'object') continue
    const kind = typeof c.component_kind === 'string' && COMPONENT_KINDS.has(c.component_kind as ComponentKind)
      ? (c.component_kind as ComponentKind) : null
    const amount = typeof c.amount === 'number' && Number.isFinite(c.amount) && c.amount > 0 ? c.amount : null
    const currency = resolveCurrency(typeof c.currency === 'string' ? c.currency : null)
    const unit = typeof c.unit === 'string' && COMPONENT_UNITS.has(c.unit as ComponentUnit) ? (c.unit as ComponentUnit) : null
    if (!kind || amount === null || !currency || !unit) continue
    const gpuCount = typeof c.gpu_count === 'number' && c.gpu_count > 0 ? c.gpu_count : null
    const taxBasis: TaxBasis = typeof c.tax_basis === 'string' && TAX_BASES.has(c.tax_basis as TaxBasis)
      ? (c.tax_basis as TaxBasis) : 'unknown'
    const provenance = typeof c.provenance === 'string' && c.provenance.trim().length > 0
      ? c.provenance.slice(0, 200) : fallbackProvenance
    out.push({ component_kind: kind, amount, currency, unit, gpu_count: gpuCount, tax_basis: taxBasis, provenance })
  }
  return out.length > 0 ? out : undefined
}

export interface FxSnapshot {
  fxMap: FxKrwMap
  krwPerUsd: number
  fxRateDate: string | null
  fxSource: string
}

/**
 * AI 원본 보고 1건 → CompetitorPriceItem(obs+price_usd 포함). 모델명/경쟁사명 없으면 null(스킵).
 * 산술: amount ÷ HOURS_PER_PERIOD[period] ÷ gpuCount = 원본통화 기준 GPU 1장·1시간당 금액(original_price).
 *       그 값을 amountToKrw로 KRW 환산 후 krwPerUsd로 나눠 price_usd(지원 통화만; 그 외는 null=보류).
 */
export function buildMarketRefreshCompetitorItem(
  raw: RawMarketRefreshItem,
  fx: FxSnapshot,
): CompetitorPriceItem | null {
  const competitorName = typeof raw.competitor_name === 'string' ? raw.competitor_name.trim() : ''
  const modelName = typeof raw.model_name === 'string' ? raw.model_name.trim() : ''
  if (!competitorName || !modelName) return null

  const memory = typeof raw.memory === 'string' ? raw.memory.trim() : ''
  const notes = typeof raw.notes === 'string' ? raw.notes.trim() : ''
  const context = typeof raw.context === 'string' && raw.context.trim().length > 0
    ? raw.context.trim()
    : [modelName, memory, notes].filter((v) => v.length > 0).join(' ')

  const currency = resolveCurrency(typeof raw.currency === 'string' ? raw.currency : null) ?? 'USD'
  const period: Period = resolvePeriod(typeof raw.pricing_unit === 'string' ? raw.pricing_unit : null) ?? 'hour'
  const declaredGpuCount = typeof raw.gpu_count === 'number' && raw.gpu_count > 0 ? raw.gpu_count : null
  const gpuCount = declaredGpuCount ?? resolveGpuCount(context) ?? 1
  const rawAmount = typeof raw.amount === 'number' && Number.isFinite(raw.amount) && raw.amount > 0 ? raw.amount : null

  const hours = HOURS_PER_PERIOD[period]
  // 원본통화 기준 GPU 1장·1시간당 금액(순수 산술 — 통화 변환 없음).
  const perGpuHourOriginal = rawAmount !== null ? rawAmount / hours / gpuCount : null

  let priceUsd: number | null = null
  if (perGpuHourOriginal !== null) {
    const krw = amountToKrw(perGpuHourOriginal, currency, fx.fxMap)
    if (krw !== null && fx.krwPerUsd > 0) priceUsd = krw / fx.krwPerUsd
  }
  if (priceUsd !== null && (!Number.isFinite(priceUsd) || priceUsd <= 0)) priceUsd = null

  const cls = classifyObservation(context)
  const provenance = context.slice(0, 200)
  const components = sanitizeMarketRefreshComponents(raw.components, provenance)

  const item: CompetitorPriceItem = {
    competitor_name: competitorName,
    model_name: modelName,
    ...(memory ? { memory } : {}),
    price_usd: priceUsd,
    pricing_model: typeof raw.pricing_model === 'string' && raw.pricing_model.trim().length > 0
      ? raw.pricing_model.trim() : 'on-demand',
    ...(notes ? { notes } : {}),
    original_currency: currency,
    original_price: perGpuHourOriginal,
    obs: {
      amount: rawAmount,
      currency,
      pricing_unit: period,
      gpu_count: gpuCount,
      segment: cls.segment,
      bundle_inclusive: cls.bundle_inclusive,
      tax_basis: cls.tax_basis,
      comparable: cls.comparable,
      fx_rate: currency === 'KRW' ? 1 : fx.fxMap[currency] ?? null,
      fx_rate_date: fx.fxRateDate,
      fx_source: fx.fxSource,
      provenance,
    },
    ...(components ? { components } : {}),
  }
  return item
}
