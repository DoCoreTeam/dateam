import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMapping, applyMapping, type CatalogMapping } from './catalog-map.ts'

const HEADERS = ['instance', 'location', 'price', 'gpu_name', 'gpu_memory', 'gpu_count', 'spot']

const goodMapping: CatalogMapping = {
  competitor_name: 'location', model_name: 'gpu_name', memory: 'gpu_memory',
  price_usd: 'price', pricing_model: 'spot', _location_split: true, _unit: 'per_hour', _currency: 'USD', _confidence: 92,
}

test('validateMapping: 필수 필드 매핑되면 통과', () => {
  const m = validateMapping({ ...goodMapping }, HEADERS)
  assert.ok(m)
  assert.equal(m!.competitor_name, 'location')
  assert.equal(m!._location_split, true)
})

test('validateMapping: 필수 필드(competitor_name) 누락이면 null', () => {
  assert.equal(validateMapping({ ...goodMapping, competitor_name: null }, HEADERS), null)
})

test('validateMapping: 환각 컬럼(헤더에 없는)은 null 처리 → 필수면 전체 null', () => {
  assert.equal(validateMapping({ ...goodMapping, price_usd: 'no_such_col' }, HEADERS), null)
})

test('validateMapping: _currency 기본 USD, _confidence 범위 밖이면 50', () => {
  const m = validateMapping({ competitor_name: 'location', model_name: 'gpu_name', price_usd: 'price', _confidence: 999 }, HEADERS)
  assert.ok(m)
  assert.equal(m!._currency, 'USD')
  assert.equal(m!._confidence, 50)
})

test('applyMapping: location 복합값 → 업체명만 분리', () => {
  const rows = [{ location: 'spheron-ai/CANADA-1', gpu_name: 'A6000', gpu_memory: 48, price: 0.5351, spot: false }]
  const out = applyMapping(rows, goodMapping)
  assert.equal(out.length, 1)
  assert.equal(out[0].competitor_name, 'spheron-ai')
  assert.equal(out[0].model_name, 'A6000')
  assert.equal(out[0].price_usd, 0.5351)
  assert.equal(out[0].pricing_model, 'on_demand')
})

test('applyMapping: price 문자열·통화기호 → number', () => {
  const rows = [{ location: 'x/y', gpu_name: 'H100', price: '$1,234.56', spot: true }]
  const out = applyMapping(rows, goodMapping)
  assert.equal(out[0].price_usd, 1234.56)
  assert.equal(out[0].pricing_model, 'spot')
})

test('applyMapping: 모델/업체/가격 없는 행은 skip', () => {
  const rows = [
    { location: 'x/y', gpu_name: '', price: 1 },        // 모델 없음
    { location: '', gpu_name: 'H100', price: 1 },        // 업체 없음
    { location: 'a/b', gpu_name: 'H100', price: null },  // 가격 없음
    { location: 'a/b', gpu_name: 'H100', price: 2.5, spot: false }, // 정상
  ]
  const out = applyMapping(rows, goodMapping)
  assert.equal(out.length, 1)
  assert.equal(out[0].model_name, 'H100')
})

test('applyMapping: 월 단가(_unit=per_month)는 시간당으로 환산(÷720, hours.ts SSOT)', () => {
  const rows = [{ location: 'x/y', gpu_name: 'H100', price: 720, spot: false }]
  const out = applyMapping(rows, { ...goodMapping, _unit: 'per_month' })
  assert.equal(out[0].price_usd, 1)  // 720/월 → 1/시간 (월=720h SSOT, 720/730 이원화 해소)
})

test('applyMapping: per_hour/unknown은 원값 유지', () => {
  const rows = [{ location: 'x/y', gpu_name: 'H100', price: 2.5, spot: false }]
  assert.equal(applyMapping(rows, { ...goodMapping, _unit: 'per_hour' })[0].price_usd, 2.5)
  assert.equal(applyMapping(rows, { ...goodMapping, _unit: 'unknown' })[0].price_usd, 2.5)
})

test('applyMapping: 결정성 — 동일 입력 2회 동일 출력', () => {
  const rows = [{ location: 'spheron-ai/CANADA-1', gpu_name: 'A6000', gpu_memory: 48, price: 0.5351, spot: false }]
  assert.deepEqual(applyMapping(rows, goodMapping), applyMapping(rows, goodMapping))
})
