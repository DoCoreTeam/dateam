import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickSellPrice, pickMargin } from './unified-price-pick.ts'

test('전략가 set → strategic_krw 우선', () => {
  assert.equal(pickSellPrice({ is_strategic_set: true, strategic_krw: 4820000, strategic_price_krw: 4800000, candidate_price_krw: 4710000 }), 4820000)
})

test('전략가 set + strategic_krw null → strategic_price_krw 폴백', () => {
  assert.equal(pickSellPrice({ is_strategic_set: true, strategic_krw: null, strategic_price_krw: 4800000, candidate_price_krw: 4710000 }), 4800000)
})

test('DC-QA#2: 전략가 set인데 두 전략가 모두 null → null(측정·표시 안전)', () => {
  assert.equal(pickSellPrice({ is_strategic_set: true, strategic_krw: null, strategic_price_krw: null, candidate_price_krw: 4710000 }), null)
})

test('전략가 미set → 판매가 후보', () => {
  assert.equal(pickSellPrice({ is_strategic_set: false, strategic_krw: 9999999, strategic_price_krw: null, candidate_price_krw: 4710000 }), 4710000)
})

test('전략가 미set + 후보 null → null', () => {
  assert.equal(pickSellPrice({ is_strategic_set: false, strategic_krw: null, strategic_price_krw: null, candidate_price_krw: null }), null)
})

test('마진: 전략가 set → 실효마진(null 가능)', () => {
  assert.equal(pickMargin({ is_strategic_set: true, effective_margin_pct: 38, margin_pct: 30 }), 38)
  assert.equal(pickMargin({ is_strategic_set: true, effective_margin_pct: null, margin_pct: 30 }), null)
})

test('마진: 전략가 미set → 설정 마진', () => {
  assert.equal(pickMargin({ is_strategic_set: false, effective_margin_pct: 99, margin_pct: 30 }), 30)
})
