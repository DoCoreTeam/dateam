import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  wonText, priceText, seoulTimeText, isRiskyUnknown, UNKNOWN_TEXT, UNKNOWN_PRICE_TEXT,
} from './position-labels.ts'

test('못 잰 손익은 0원이 아니라 못 쟀다고 쓴다 — 0원은 「오늘 본전」이라는 사실이다', () => {
  assert.equal(wonText(null), UNKNOWN_TEXT)
  assert.notEqual(wonText(null), '0원')
})

test('진짜 0원은 0원이라고 쓴다 — 모름과 섞지 않는다', () => {
  assert.equal(wonText(0), '0원')
  assert.notEqual(wonText(0), UNKNOWN_TEXT)
})

test('손익은 자릿수를 끊어 쓴다', () => {
  assert.equal(wonText(1_250_000), '1,250,000원')
  assert.equal(wonText(-500_000), '-500,000원')
})

test('숫자가 아닌 값도 못 잰 것이다', () => {
  assert.equal(wonText(Number.NaN), UNKNOWN_TEXT)
  assert.equal(priceText(Number.NaN), UNKNOWN_PRICE_TEXT)
})

test('손절가를 모르면 빈 칸이 아니라 모른다고 쓴다 — 빈 칸은 「손절 없음」으로 읽힌다', () => {
  assert.equal(priceText(null), UNKNOWN_PRICE_TEXT)
  assert.notEqual(priceText(null), '')
})

test('가격은 소수 둘째 자리까지', () => {
  assert.equal(priceText(340), '340.00')
  assert.equal(priceText(338.5), '338.50')
})

test('손절가를 모르는 것은 정보가 아니라 위험이다', () => {
  assert.equal(isRiskyUnknown(null), true)
  assert.equal(isRiskyUnknown(338), false)
  // 손절가 0 은 「모름」이 아니다. 이상한 값이지만 우리가 아는 값이다
  assert.equal(isRiskyUnknown(0), false)
})

test('시각을 못 읽으면 지어내지 않는다', () => {
  assert.equal(seoulTimeText('말이 안 되는 값'), UNKNOWN_PRICE_TEXT)
})

test('시각은 서울 기준으로 쓴다', () => {
  // UTC 00:30 은 서울 09:30, 장 시작 직후다
  assert.match(seoulTimeText('2026-09-26T00:30:00Z'), /09:30/)
})
