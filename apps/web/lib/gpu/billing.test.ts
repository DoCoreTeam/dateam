import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBilling } from './billing.ts'

test('설치비+월단가 → one_time_plus_monthly 추론', () => {
  const r = parseBilling({ setup_fee_krw: 500000, monthly_price_krw: 3189800 })
  assert.equal(r.setupFeeKrw, 500000)
  assert.equal(r.monthlyPriceKrw, 3189800)
  assert.equal(r.billingModel, 'one_time_plus_monthly')
  assert.equal(r.hasSeparateSetup, true)
})

test('월단가만 → monthly', () => {
  const r = parseBilling({ monthly_price_krw: 1000000 })
  assert.equal(r.billingModel, 'monthly')
  assert.equal(r.hasSeparateSetup, false)
})

test('과금 필드 없음 → null(hourly 취급)', () => {
  const r = parseBilling({ unit_price_usd: 2.5 })
  assert.equal(r.billingModel, null)
  assert.equal(r.setupFeeKrw, null)
  assert.equal(r.monthlyPriceKrw, null)
})

test('문자열 금액 정규화(콤마·원)', () => {
  const r = parseBilling({ setup_fee_krw: '500,000원', monthly_price_krw: '3,189,800' })
  assert.equal(r.setupFeeKrw, 500000)
  assert.equal(r.monthlyPriceKrw, 3189800)
})

test('billing_model 명시값 우선', () => {
  const r = parseBilling({ billing_model: 'hourly', monthly_price_krw: 100 })
  assert.equal(r.billingModel, 'hourly')
})

test('설치비만 있어도 분리 표시', () => {
  const r = parseBilling({ setup_fee_krw: 200000 })
  assert.equal(r.billingModel, 'one_time_plus_monthly')
  assert.equal(r.hasSeparateSetup, true)
})

test('billing_model 명시값 one_time_plus_monthly + 설치비 없음', () => {
  // AI가 모델만 분류하고 금액은 별도 라인에 못 넣은 경우 — 명시값 보존
  const r = parseBilling({ billing_model: 'one_time_plus_monthly', monthly_price_krw: 3189800 })
  assert.equal(r.billingModel, 'one_time_plus_monthly')
  assert.equal(r.setupFeeKrw, null)
  assert.equal(r.hasSeparateSetup, false)
})
