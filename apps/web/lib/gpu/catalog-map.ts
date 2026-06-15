// 카탈로그 헤더 매핑 검증 + 전행 결정적 변환 (순수 — 단위테스트 대상, Date/random 미사용).
// AI는 "어느 컬럼이 어느 필드인가"만 1회 판단(catalog-map prompt). 이 모듈이 전체 행을 결정적으로 변환한다.
import type { CompetitorPriceItem } from './competitor-import'

// AI가 반환하는 매핑 — 값은 "원본 컬럼명" 또는 null. _ 접두는 메타 판단.
export interface CatalogMapping {
  competitor_name: string | null
  model_name: string | null
  memory: string | null
  price_usd: string | null
  pricing_model: string | null
  _location_split: boolean
  _unit: 'per_hour' | 'per_month' | 'unknown'
  _currency: string
  _confidence: number
}

const FIELD_KEYS = ['competitor_name', 'model_name', 'memory', 'price_usd', 'pricing_model'] as const

/** AI 반환 raw → 검증된 CatalogMapping. 필수(competitor_name·model_name·price_usd) 매핑 없으면 null. */
export function validateMapping(raw: unknown, headers: string[]): CatalogMapping | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const headerSet = new Set(headers)
  // 컬럼명은 반드시 실제 헤더에 존재해야 함(환각 컬럼 차단). 없으면 null 처리.
  const col = (k: string): string | null => {
    const v = r[k]
    return typeof v === 'string' && headerSet.has(v) ? v : null
  }
  const mapping: CatalogMapping = {
    competitor_name: col('competitor_name'),
    model_name: col('model_name'),
    memory: col('memory'),
    price_usd: col('price_usd'),
    pricing_model: col('pricing_model'),
    _location_split: r._location_split === true,
    _unit: r._unit === 'per_hour' || r._unit === 'per_month' ? r._unit : 'unknown',
    _currency: typeof r._currency === 'string' && r._currency.trim() ? r._currency.trim().toUpperCase() : 'USD',
    _confidence: typeof r._confidence === 'number' && r._confidence >= 0 && r._confidence <= 100 ? Math.round(r._confidence) : 50,
  }
  // 필수 필드 매핑 검증
  if (!mapping.competitor_name || !mapping.model_name || !mapping.price_usd) return null
  return mapping
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    // 통화기호·천단위 콤마 제거 후 숫자화
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

// 월 단가 → 시간 단가 환산 계수 (평균 730시간/월). 우리 표준은 USD/GPU·hr.
const HOURS_PER_MONTH = 730

/** 단위 정규화 — per_month면 시간당으로 환산. unknown/per_hour는 원값. */
function toHourly(price: number, unit: CatalogMapping['_unit']): number {
  if (unit === 'per_month') return Math.round((price / HOURS_PER_MONTH) * 1e6) / 1e6
  return price
}

/** 업체명 추출 — _location_split이면 "vendor/region"의 / 앞을 업체로. */
function vendorOf(raw: unknown, split: boolean): string {
  const s = str(raw)
  if (!s) return ''
  return split ? (s.split('/')[0] ?? s).trim() : s
}

/** spot 컬럼/문자 → pricing_model enum. true/spot → 'spot', 그 외 → 'on_demand'. */
function pricingModelOf(raw: unknown): string {
  if (raw === true) return 'spot'
  if (raw === false || raw == null) return 'on_demand'
  const s = String(raw).toLowerCase().replace(/-/g, '_').trim()
  if (s === 'true' || s === 'spot' || s === 'y' || s === 'yes') return 'spot'
  if (['on_demand', 'reserved_1y', 'reserved_3y', 'committed'].includes(s)) return s
  return 'on_demand'
}

/**
 * 전체 행 → CompetitorPriceItem[] (결정적). 모델명·업체명·가격이 없는 행은 skip.
 * 동일 입력 → 동일 출력(테스트 보장).
 */
export function applyMapping(rows: Record<string, unknown>[], mapping: CatalogMapping): CompetitorPriceItem[] {
  const out: CompetitorPriceItem[] = []
  for (const row of rows) {
    const competitor_name = vendorOf(mapping.competitor_name ? row[mapping.competitor_name] : null, mapping._location_split)
    const model_name = mapping.model_name ? str(row[mapping.model_name]) : ''
    const price_usd = mapping.price_usd ? toNum(row[mapping.price_usd]) : null
    if (!competitor_name || !model_name || price_usd == null) continue
    const memory = mapping.memory ? str(row[mapping.memory]) : ''
    const pricing_model = mapping.pricing_model ? pricingModelOf(row[mapping.pricing_model]) : 'on_demand'
    out.push({
      competitor_name,
      model_name,
      memory: memory || undefined,
      price_usd: toHourly(price_usd, mapping._unit),  // 월단가 등 비-시간 단위는 시간당으로 환산(시장가 오염 방지)
      pricing_model,
    })
  }
  return out
}
