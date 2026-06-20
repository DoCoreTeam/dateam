import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileRecord, parsePriceNumber, type RawRecord } from './intake-reconcile.ts'

const base: RawRecord = {
  model_name: 'T4', model_addr: 'C7', price_raw: 7_000_000, price_addr: 'D7',
  currency_token: 'KRW', unit_token: '월', gpu_count_hint: 8, term: 'on_demand',
  block_id: 'b1', source_type: 'own_target', confidence: 0.9,
}
const ctx = { krwPerUsd: 1500 }

test('가격 파싱(기호·콤마 제거)', () => {
  assert.equal(parsePriceNumber('₩7,000,000'), 7000000)
  assert.equal(parsePriceNumber('0.81'), 0.81)
  assert.equal(parsePriceNumber(6.48), 6.48)
  assert.equal(parsePriceNumber('N/A'), null)
})

test('정상 레코드 → 0.81 USD/GPU/hr, issues 없음', () => {
  const it = reconcileRecord(base, ctx)
  assert.deepEqual(it.issues, [])
  assert.ok(Math.abs(it.unit_price_usd - 0.8101851) < 0.0001)
  assert.equal(it.gpu_count, 8)
  assert.equal(it.target, 'own_target')
  assert.equal(it.provenance.price_addr, 'D7')
})

test('provenance 누락 → issue', () => {
  const it = reconcileRecord({ ...base, price_addr: '' }, ctx)
  assert.ok(it.issues.includes('missing_price_provenance'))
})

test('미지 통화 → issue (밴드룰 아님, 형식불변)', () => {
  const it = reconcileRecord({ ...base, currency_token: 'BTC', blockCurrency: null }, ctx)
  assert.ok(it.issues.includes('unknown_currency'))
})

test('음수/0 가격 → issue', () => {
  const it = reconcileRecord({ ...base, price_raw: 0 }, ctx)
  assert.ok(it.issues.includes('nonpositive_price'))
})

test('미분류 타깃 → competitor 폴백 + issue', () => {
  const it = reconcileRecord({ ...base, source_type: null }, ctx)
  assert.equal(it.target, 'competitor')
  assert.ok(it.issues.includes('unclassified_target'))
})

test('블록 단서 폴백(레코드 토큰 없을 때)', () => {
  const it = reconcileRecord(
    { ...base, currency_token: null, unit_token: null, gpu_count_hint: null, model_name: 'T4' },
    { krwPerUsd: 1500, blockCurrency: 'KRW', blockUnit: '월', blockGpuCount: 8 },
  )
  assert.deepEqual(it.issues, [])
  assert.ok(Math.abs(it.unit_price_usd - 0.8101851) < 0.0001)
})
