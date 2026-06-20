// components/pricing/gpu/cockpit/types.ts
// 가격 콕핏 FE 타입 — BE 응답 필드 기준 (동시작업 BE 완료 후 자동 정합)

export interface StrategicHistoryEntry {
  ts: string
  actor: string
  before: number | null
  after: number | null
  reason: string | null
}

export interface CostSupplier {
  supplier_name: string
  unit_price_krw: number
  gpu_count: number
  quote_id: string | null
  basis: string | null
  /** true = 실제 견적 없음, 상위 구성에서 전파 추정된 원가 */
  is_propagated?: boolean
}

export interface Competitor {
  company_name: string
  price_krw: number
  recorded_at: string
  /** 이 경쟁사가 공급사로 연결되어 있으면 공급사명, 아니면 null/undefined (연계 배지) */
  linked_supplier_name?: string | null
}

export interface CockpitProduct {
  id: string
  model_name: string
  memory: string
  tier: 1 | 2 | 3
  gpu_count: number
  series: string | null

  // gcube 사이트 가격
  gcube_site_price_krw: number | null
  gcube_site_quote_id: string | null
  gcube_site_updated_at: string | null

  // 원가 범위 — cost_min/max는 절대 단가 범위(표시 전용)
  cost_min_krw: number | null
  cost_max_krw: number | null
  /** 기준 공급원가 — 가격결정(공급원가·판매가 추천)의 SSOT 기준값(지정/실효). 절대최저 아님. */
  cost_basis_krw?: number | null
  cost_suppliers: CostSupplier[]
  /** 원가 출처 — 'market_link'(경쟁사 공시가 인입) | 'quote'(실견적). Phase3 */
  cost_source?: 'market_link' | 'quote'

  // 판매가 후보
  candidate_price_krw: number | null
  margin_pct: number | null

  // 경쟁사
  competitor_min_krw: number | null
  competitor_max_krw: number | null
  competitors: Competitor[]

  // 전략가(우리 판매가)
  strategic_price_krw: number | null
  strategic_krw: number | null
  is_strategic_set: boolean
  effective_margin_pct: number | null

  // 전략가 이력
  strategic_history: StrategicHistoryEntry[]

  // 하위 호환 (기존 cockpit BE 필드 — 새 BE 완성 전 폴백용)
  cost_krw?: number | null
  auto_margin_krw?: number | null
  market_median_krw?: number | null
  market_min_krw?: number | null
  market_max_krw?: number | null
  market_deviation_pct?: number | null
  basis?: string | null
  /** 행 수준 원가가 전파 추정값인지 (실제 견적 없음, 상위 구성에서 전파) */
  is_propagated?: boolean
  /** Phase3 BE 명시 필드 — is_propagated와 동일 역할 */
  cost_is_propagated?: boolean
  effective_supplier?: string | null
  /** 전파 근거: 1GPU당 USD 단가 */
  per_gpu_usd?: number | null
  list_price_krw?: number | null
  pricing_mode?: string
}

export interface CockpitResponse {
  products: CockpitProduct[]
  usd_krw: number
  fx_date: string | null
  margin_pct: number
}

export type ExpandSection = 'cost' | 'competitor' | 'gcube' | 'strategic' | null

export interface ExpandedState {
  productId: string
  section: ExpandSection
}

export type SortKey = 'model' | 'gcube' | 'cost' | 'candidate' | 'competitor' | 'strategic'
export type SortDir = 'asc' | 'desc'

export interface SortConfig {
  key: SortKey
  dir: SortDir
}
