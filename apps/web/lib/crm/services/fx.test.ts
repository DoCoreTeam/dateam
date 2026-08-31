/**
 * 환율 환산 — **통화 자릿수를 빠뜨리면 100배 틀린다**
 *
 * 실제로 그랬다: USD 의 minor 는 센트라 `66000` 은 $660 인데,
 * 자릿수를 안 보고 곱해서 **66,000 달러**로 환산했다(₩913,836 → ₩91,383,600).
 * 그럴듯한 숫자라 눈으로는 안 걸린다 — 그래서 가드가 필요하다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toKrwMinor, needsFx } from './fx.ts'

test('USD 는 센트다 — 자릿수를 반영해 환산한다', () => {
  // $660.00 = 66,000 센트 · 1 USD = 1,384.6 원 → 913,836 원
  assert.equal(toKrwMinor(BigInt(66_000), 'USD', 1384.6), BigInt(913_836))
  // 100배 틀린 값이 나오면 안 된다 — 그게 실제로 났던 사고다
  assert.notEqual(toKrwMinor(BigInt(66_000), 'USD', 1384.6), BigInt(91_383_600))
})

test('KRW 는 자릿수가 0 — 그대로 간다', () => {
  assert.equal(toKrwMinor(BigInt(1_000_000), 'KRW', 1), BigInt(1_000_000))
  assert.equal(needsFx('KRW'), false)
  assert.equal(needsFx('krw'), false)
})

test('JPY 는 자릿수가 0 — 엔은 소수가 없다', () => {
  // ¥10,000 · 1 JPY = 9.4 원 → 94,000 원
  assert.equal(toKrwMinor(BigInt(10_000), 'JPY', 9.4), BigInt(94_000))
})

test('환산할 통화인지 판정', () => {
  assert.equal(needsFx('USD'), true)
  assert.equal(needsFx('EUR'), true)
  assert.equal(needsFx(''), false)
  assert.equal(needsFx(null), false)
  assert.equal(needsFx(undefined), false)
})

test('EUR 도 센트 — 자릿수 2 통화는 모두 같은 규칙', () => {
  // €1,000.00 = 100,000 센트 · 1 EUR = 1,620 원 → 1,620,000 원
  assert.equal(toKrwMinor(BigInt(100_000), 'EUR', 1620), BigInt(1_620_000))
})
