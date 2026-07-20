import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMarketRefreshCompetitorItem, sanitizeMarketRefreshComponents, type FxSnapshot } from './market-refresh-item.ts'

const fx = (overrides: Partial<FxSnapshot> = {}): FxSnapshot => ({
  fxMap: { KRW: 1, USD: 1400, JPY: 9.5 },
  krwPerUsd: 1400,
  fxRateDate: '2026-07-20',
  fxSource: 'koreaexim',
  ...overrides,
})

test('buildMarketRefreshCompetitorItem — 모델명/경쟁사명 없으면 null', () => {
  assert.equal(buildMarketRefreshCompetitorItem({}, fx()), null)
  assert.equal(buildMarketRefreshCompetitorItem({ competitor_name: 'RunPod' }, fx()), null)
})

test('buildMarketRefreshCompetitorItem — USD·시간당·1장(가장 단순한 케이스)은 그대로 price_usd', () => {
  const item = buildMarketRefreshCompetitorItem({
    competitor_name: 'RunPod', model_name: 'H100', memory: '80GB',
    amount: 2.39, currency: 'USD', pricing_unit: 'hour', gpu_count: 1,
  }, fx())!
  assert.ok(item)
  assert.equal(item.price_usd, 2.39)
  assert.equal(item.original_currency, 'USD')
  assert.equal(item.original_price, 2.39)
  assert.equal(item.obs?.amount, 2.39)
  assert.equal(item.obs?.pricing_unit, 'hour')
  assert.equal(item.obs?.gpu_count, 1)
})

test('buildMarketRefreshCompetitorItem — 월정액·KRW·8장 묶음 → 코드가 720h·8장으로 나눈다(AI 산술 없음)', () => {
  // 138.54*10000 KRW/월, 8장 묶음 → 720시간·8장으로 나눈 뒤 KRW→USD.
  const item = buildMarketRefreshCompetitorItem({
    competitor_name: 'Nebius', model_name: 'H100', amount: 1385400, currency: 'KRW',
    pricing_unit: 'month', gpu_count: 8,
  }, fx())!
  assert.ok(item)
  const expectedOriginal = 1385400 / 720 / 8
  assert.ok(Math.abs((item.original_price ?? 0) - expectedOriginal) < 1e-9)
  assert.equal(item.original_currency, 'KRW')
  const expectedUsd = expectedOriginal / 1400
  assert.ok(Math.abs((item.price_usd ?? 0) - expectedUsd) < 1e-9)
  assert.equal(item.obs?.amount, 1385400) // obs는 원문 총액(미분할) 그대로 보존
  assert.equal(item.obs?.pricing_unit, 'month')
  assert.equal(item.obs?.gpu_count, 8)
})

test('buildMarketRefreshCompetitorItem — 지원 안 되는 통화(fx맵에 없음)는 price_usd null 보류(USD 둔갑 금지)', () => {
  const item = buildMarketRefreshCompetitorItem({
    competitor_name: 'SoftBank', model_name: 'A100', amount: 30000, currency: 'EUR', pricing_unit: 'hour',
  }, fx())!
  assert.equal(item.price_usd, null)
  assert.equal(item.original_currency, 'EUR')
  assert.equal(item.original_price, 30000) // 시간 단위라 나눗셈 없음, 원본 그대로
})

test('buildMarketRefreshCompetitorItem — gpu_count 미지정이면 context에서 추론, 실패하면 1', () => {
  const withHint = buildMarketRefreshCompetitorItem({
    competitor_name: 'RunPod', model_name: 'H100', amount: 8, currency: 'USD', pricing_unit: 'hour',
    context: 'H100 8장 묶음 서버',
  }, fx())!
  assert.equal(withHint.obs?.gpu_count, 8)

  const noHint = buildMarketRefreshCompetitorItem({
    competitor_name: 'RunPod', model_name: 'H100', amount: 2.39, currency: 'USD', pricing_unit: 'hour',
  }, fx())!
  assert.equal(noHint.obs?.gpu_count, 1)
})

test('buildMarketRefreshCompetitorItem — pricing_unit 미지정은 hour 기본값', () => {
  const item = buildMarketRefreshCompetitorItem({
    competitor_name: 'RunPod', model_name: 'H100', amount: 2.39, currency: 'USD',
  }, fx())!
  assert.equal(item.obs?.pricing_unit, 'hour')
  assert.equal(item.price_usd, 2.39)
})

test('buildMarketRefreshCompetitorItem — amount 없음(가격 미상)이면 price_usd·original_price 모두 null', () => {
  const item = buildMarketRefreshCompetitorItem({
    competitor_name: 'RunPod', model_name: 'H100', currency: 'USD', pricing_unit: 'hour',
  }, fx())!
  assert.equal(item.price_usd, null)
  assert.equal(item.original_price, null)
  assert.equal(item.obs?.amount, null)
})

test('buildMarketRefreshCompetitorItem — obs 세그먼트는 classifyObservation로 결정(번들 신호 있으면 managed_bundle)', () => {
  const bundle = buildMarketRefreshCompetitorItem({
    competitor_name: 'SoftBank', model_name: 'H100', amount: 2500000, currency: 'JPY', pricing_unit: 'month',
    context: 'DGX H100 プラン ストレージ込み',
  }, fx())!
  assert.equal(bundle.obs?.segment, 'managed_bundle')
  assert.equal(bundle.obs?.comparable, false)

  const raw = buildMarketRefreshCompetitorItem({
    competitor_name: 'RunPod', model_name: 'H100', amount: 2.39, currency: 'USD', pricing_unit: 'hour',
  }, fx())!
  assert.equal(raw.obs?.segment, 'raw_gpu')
  assert.equal(raw.obs?.comparable, true)
})

test('buildMarketRefreshCompetitorItem — components 없으면 CompetitorPriceItem.components는 undefined', () => {
  const item = buildMarketRefreshCompetitorItem({
    competitor_name: 'RunPod', model_name: 'H100', amount: 2.39, currency: 'USD', pricing_unit: 'hour',
  }, fx())!
  assert.equal(item.components, undefined)
})

test('buildMarketRefreshCompetitorItem — 완전한 components는 그대로 전달(무손실 성분 저장용)', () => {
  const item = buildMarketRefreshCompetitorItem({
    competitor_name: 'SoftBank', model_name: 'A100', amount: 7.2, currency: 'JPY', pricing_unit: 'minute',
    components: [
      { component_kind: 'base_fee', amount: 30000, currency: 'JPY', unit: 'month' },
      { component_kind: 'usage', amount: 7.2, currency: 'JPY', unit: 'minute', gpu_count: 1 },
      { component_kind: 'storage', amount: 1000, currency: 'JPY', unit: 'per_gb' },
    ],
  }, fx())!
  assert.equal(item.components?.length, 3)
  assert.equal(item.components?.[0].component_kind, 'base_fee')
  assert.equal(item.components?.[1].unit, 'minute')
})

test('sanitizeMarketRefreshComponents — 필수필드 불완전 성분은 스킵', () => {
  const out = sanitizeMarketRefreshComponents([
    { component_kind: 'base_fee', amount: 100, currency: 'USD', unit: 'month' }, // 완전
    { component_kind: 'bogus_kind', amount: 100, currency: 'USD', unit: 'month' }, // 잘못된 kind
    { component_kind: 'usage', amount: -5, currency: 'USD', unit: 'hour' }, // 음수 금액
    { component_kind: 'usage', currency: 'USD', unit: 'hour' }, // amount 없음
  ], 'fallback provenance')
  assert.equal(out?.length, 1)
  assert.equal(out?.[0].component_kind, 'base_fee')
})

test('sanitizeMarketRefreshComponents — 빈 배열/비배열이면 undefined', () => {
  assert.equal(sanitizeMarketRefreshComponents(undefined, 'p'), undefined)
  assert.equal(sanitizeMarketRefreshComponents([], 'p'), undefined)
  assert.equal(sanitizeMarketRefreshComponents('not-array', 'p'), undefined)
})

test('sanitizeMarketRefreshComponents — provenance 없으면 fallback 사용', () => {
  const out = sanitizeMarketRefreshComponents([
    { component_kind: 'flat', amount: 100, currency: 'USD', unit: 'month' },
  ], 'fallback provenance')
  assert.equal(out?.[0].provenance, 'fallback provenance')
})
