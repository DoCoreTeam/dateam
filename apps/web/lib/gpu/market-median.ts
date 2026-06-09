// lib/gpu/market-median.ts — 시장 median 계산 helper (SSOT)
//
// market/route.ts와 cockpit/route.ts가 동일한 로직을 공유하도록 추출.
// 호출부는 DB 쿼리 결과(mappings, latestPrices)를 주입한다.

/** 숫자 배열에서 중앙값을 반환한다. 빈 배열이면 null. */
export function calcMedian(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export interface MarketMedianResult {
  market_median_usd: number | null
  market_min_usd: number | null
  market_max_usd: number | null
}

/**
 * gpu_product_id별 시장 median/min/max(USD)를 계산한다.
 *
 * @param mappings  competitor_product_mapping 행 배열 (is_active=true)
 * @param latestPriceMap  mapping_id → 최신 market_prices 행 (Map)
 * @returns  Map<product_id, MarketMedianResult>
 */
export function buildMarketMedianMap(
  mappings: Array<{ id: string; gpu_product_id: string }>,
  latestPriceMap: Map<string, { price_usd: number | null }>,
): Map<string, MarketMedianResult> {
  // product_id → 유효 가격(USD) 배열
  const pricesByProduct = new Map<string, number[]>()

  for (const m of mappings) {
    const pid = m.gpu_product_id
    const price = latestPriceMap.get(m.id)?.price_usd
    if (price == null) continue
    if (!pricesByProduct.has(pid)) pricesByProduct.set(pid, [])
    pricesByProduct.get(pid)!.push(price)
  }

  const result = new Map<string, MarketMedianResult>()
  Array.from(pricesByProduct.entries()).forEach(([pid, prices]) => {
    const sorted = [...prices].sort((a, b) => a - b)
    result.set(pid, {
      market_min_usd: sorted[0],
      market_max_usd: sorted[sorted.length - 1],
      market_median_usd: calcMedian(sorted),
    })
  })
  return result
}
