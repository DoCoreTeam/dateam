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

// 최신 시세 행(밴드 계산 입력). obs_segment·observed_at은 확정 기획 P4 격리용(있을 때만 필터, NULL=포함).
export interface LatestPriceRow {
  price_usd: number | null
  obs_segment?: string | null   // 'managed_bundle'이면 밴드 제외(참고전용). NULL/raw_gpu=포함.
  observed_at?: string | null   // ISO. staleDays·nowIso와 함께 신선도 판정. NULL=포함.
}

// 비교가능성 필터 옵션(확정 기획 P4). 기본은 무필터(기존 호출부 무영향 — 옵션·필드 미주입 시 전부 포함).
export interface MedianOptions {
  includeBundle?: boolean  // true면 managed_bundle도 포함. 기본 false(콕핏 밴드=raw만).
  staleDays?: number       // observed_at이 nowIso보다 이만큼 오래되면 제외. 미지정=신선도 무필터.
  nowIso?: string          // 기준 시각(테스트 결정성). 미지정이면 신선도 필터 비활성.
}

const DAY_MS = 86_400_000

function isExcluded(row: LatestPriceRow | undefined, opt: MedianOptions): boolean {
  if (!row) return true
  // 세그먼트: managed_bundle은 기본 제외(비교 불가를 밴드에 섞지 않음). NULL/raw_gpu는 포함.
  if (!opt.includeBundle && row.obs_segment === 'managed_bundle') return true
  // 신선도: nowIso·staleDays 둘 다 있고 observed_at이 있을 때만 판정(없으면 포함 — 기존 데이터 보호).
  if (opt.nowIso && typeof opt.staleDays === 'number' && row.observed_at) {
    const age = Date.parse(opt.nowIso) - Date.parse(row.observed_at)
    if (Number.isFinite(age) && age > opt.staleDays * DAY_MS) return true
  }
  return false
}

/**
 * gpu_product_id별 시장 median/min/max(USD)를 계산한다.
 * P4: managed_bundle·stale 시세는 밴드에서 격리(옵션). obs 필드/옵션 미주입 시 기존과 동일(전부 포함).
 */
export function buildMarketMedianMap(
  mappings: Array<{ id: string; gpu_product_id: string }>,
  latestPriceMap: Map<string, LatestPriceRow>,
  options: MedianOptions = {},
): Map<string, MarketMedianResult> {
  // product_id → 유효 가격(USD) 배열
  const pricesByProduct = new Map<string, number[]>()

  for (const m of mappings) {
    const pid = m.gpu_product_id
    const row = latestPriceMap.get(m.id)
    const price = row?.price_usd
    if (price == null) continue
    if (isExcluded(row, options)) continue   // P4: 번들·stale 격리
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
