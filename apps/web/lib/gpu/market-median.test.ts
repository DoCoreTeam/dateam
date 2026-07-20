import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMarketMedianMap, calcMedian, type LatestPriceRow } from './market-median.ts'

const maps = [
  { id: 'm1', gpu_product_id: 'p1' },
  { id: 'm2', gpu_product_id: 'p1' },
  { id: 'm3', gpu_product_id: 'p1' },
]

test('calcMedian 기본', () => {
  assert.equal(calcMedian([1, 2, 3]), 2)
  assert.equal(calcMedian([1, 2, 3, 4]), 2.5)
  assert.equal(calcMedian([]), null)
})

test('옵션·obs 필드 없으면 전부 포함(기존 호출부 무영향)', () => {
  const lp = new Map<string, LatestPriceRow>([
    ['m1', { price_usd: 2 }], ['m2', { price_usd: 4 }], ['m3', { price_usd: 6 }],
  ])
  const r = buildMarketMedianMap(maps, lp).get('p1')!
  assert.equal(r.market_min_usd, 2); assert.equal(r.market_max_usd, 6); assert.equal(r.market_median_usd, 4)
})

test('P4: managed_bundle은 기본 제외(콕핏 밴드=raw만), NULL/raw_gpu는 포함', () => {
  const lp = new Map<string, LatestPriceRow>([
    ['m1', { price_usd: 2, obs_segment: 'raw_gpu' }],
    ['m2', { price_usd: 4, obs_segment: null }],
    ['m3', { price_usd: 999, obs_segment: 'managed_bundle' }], // 번들 → 제외
  ])
  const r = buildMarketMedianMap(maps, lp).get('p1')!
  assert.equal(r.market_max_usd, 4, '번들 999 제외돼야 함')
  // includeBundle=true면 포함
  const r2 = buildMarketMedianMap(maps, lp, { includeBundle: true }).get('p1')!
  assert.equal(r2.market_max_usd, 999)
})

test('P4: stale(오래된) 시세는 nowIso+staleDays 있을 때 제외, observed_at 없으면 포함', () => {
  const lp = new Map<string, LatestPriceRow>([
    ['m1', { price_usd: 2, observed_at: '2026-07-19T00:00:00Z' }], // 1일 전 → 포함
    ['m2', { price_usd: 4, observed_at: '2026-01-01T00:00:00Z' }], // 200일 전 → 제외
    ['m3', { price_usd: 6 }], // observed_at 없음 → 포함(기존 데이터 보호)
  ])
  const r = buildMarketMedianMap(maps, lp, { staleDays: 90, nowIso: '2026-07-20T00:00:00Z' }).get('p1')!
  assert.equal(r.market_min_usd, 2); assert.equal(r.market_max_usd, 6) // 4(stale) 제외, 2·6 남음
})
