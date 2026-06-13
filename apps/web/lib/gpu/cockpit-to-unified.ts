// 어댑터: /api/pricing/gpu/cockpit 응답 → UnifiedRow[] (통합 표 좌측 목록)
//
// 계산하지 않는다(R1): 가격은 cockpit 응답값 그대로, 시장 중앙값만 SSOT calcMedian 재사용.
// cockpit 미포함 축(재고·고객가)은 null — 해당 보기는 후속 어댑터에서 보강(P1-3b).

import { calcMedian } from './market-median'
import { GPU_TERMS } from './terms'
import { pickSellPrice, pickMargin, marketDevPct } from './unified-price-pick'
import type { UnifiedRow } from './unified-row'

interface CockpitCompetitor {
  company_name: string
  price_krw: number
  recorded_at: string | null
}

export interface CockpitApiRow {
  id: string
  model_name: string
  memory: string | null
  tier: number | null
  cost_min_krw: number | null
  cost_source: 'market_link' | 'quote'
  candidate_price_krw: number | null
  sell_price_krw: number | null // buildCatalog 최종 판매가(공시가 폴백 포함)
  basis?: string | null // auto/selected/propagated/list/none
  gcube_site_price_krw?: number | null // gcube 공시가
  margin_pct: number
  competitor_min_krw: number | null
  competitor_max_krw: number | null
  competitors: CockpitCompetitor[]
  competitor_mapping_ids?: string[]
  strategic_krw: number | null
  strategic_price_krw: number | null
  is_strategic_set: boolean
  effective_margin_pct: number | null
  cost_suppliers?: { supplier_name: string }[]
}

export interface CockpitApiResponse {
  products: CockpitApiRow[]
  usd_krw?: number | null
}

/** cockpit 응답 → 통합 표 행. sell_price = 전략가(설정 시) 또는 판매가 후보. */
export function cockpitToUnified(res: CockpitApiResponse | undefined): UnifiedRow[] {
  if (!res?.products) return []
  return res.products.map((p): UnifiedRow => {
    // 시장 중앙값: 경쟁사 가격(이미 오름차순)에 SSOT calcMedian 적용 — 직접 계산 아님
    const compPrices = p.competitors.map((c) => c.price_krw)
    const marketMedian = calcMedian(compPrices)
    const supplierName = p.cost_suppliers?.[0]?.supplier_name ?? null
    // 판매가·마진 선택은 자기완결 SSOT(unified-price-pick)에 위임 — 단위 테스트로 분기 고정.
    // 전략가/견적 후보가 없으면 buildCatalog 최종 판매가(공시가 폴백)로 채움 — 가격표 SSOT와 동일(빈 행 방지).
    const pricedSell = pickSellPrice(p)
    const sellFromList = pricedSell == null && p.sell_price_krw != null
    const sellPrice = pricedSell ?? p.sell_price_krw ?? null
    // 견적 기반 판매가면 실효/설정 마진. 공시가 폴백이면 단순 패스스루 → 마진 측정불가(null, 정직 표기).
    const margin = sellPrice == null || sellFromList ? null : pickMargin(p)

    return {
      id: p.id,
      model_name: p.model_name,
      memory: p.memory,
      tier: p.tier,
      supply_cost_krw: p.cost_min_krw,
      auto_price_krw: p.candidate_price_krw,
      sell_price_krw: sellPrice,
      margin_pct: margin,
      cost_source: p.cost_source,
      basis: p.basis ?? null,
      list_price_krw: p.gcube_site_price_krw ?? null,
      market_min_krw: p.competitor_min_krw,
      market_median_krw: marketMedian,
      market_max_krw: p.competitor_max_krw,
      market_dev_pct: marketDevPct(sellPrice, marketMedian), // 판매가 vs 시장 중앙값 편차%(SSOT 함수)
      sample_count: p.competitors.length,
      market_mapping_id: p.competitor_mapping_ids?.[0] ?? null,
      market_mapping_ids: p.competitor_mapping_ids ?? [],
      competitors: p.competitors.map((c) => ({
        company_name: c.company_name,
        price_krw: c.price_krw,
        recorded_at: c.recorded_at,
      })),
      // 재고·고객가 축: cockpit 미포함(후속 어댑터에서 병합)
      supplier_name: supplierName,
      available_qty: null,
      stock_status: null,
      valid_until: null,
      partner_tier: null,
      discount_rate: null,
      customer_price_krw: null,
      status: p.is_strategic_set ? GPU_TERMS.statusConfirmed : null,
    }
  })
}
