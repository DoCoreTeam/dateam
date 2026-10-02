// 금액 표시 SSOT — 보드·표·장부·견적서가 **같은 함수**를 쓴다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAmount, minorDigits, currencyAffix, toMinorAmount } from './amount.ts'

test('원화는 「원」을 뒤에 붙인다 — 한국어 문서에 KRW 라고 쓰는 곳은 없다', () => {
  assert.equal(formatAmount('548375000', 'KRW'), '548,375,000원')
  assert.equal(formatAmount('0', 'KRW'), '0원')
})

test('달러·유로는 기호를 앞에 — 「1,000 USD」도 사람이 쓰는 말이 아니다', () => {
  // 달러는 **늘 두 자리**다 — 「$1,200」이나 「$1,080.5」로 적는 곳은 없다
  assert.equal(formatAmount('120000', 'USD'), '$1,200.00')
  assert.equal(formatAmount('108000', 'USD'), '$1,080.00')
  assert.equal(formatAmount('108050', 'USD'), '$1,080.50')
  assert.equal(formatAmount('123456', 'EUR'), '€1,234.56')
})

test('엔화는 소수가 없고 「엔」이 뒤에', () => {
  assert.equal(formatAmount('1000', 'JPY'), '1,000엔')
})

test('모르는 통화는 코드를 그대로 뒤에 — 지어내지 않는다', () => {
  // 모르는 통화는 자리수를 2 로 본다(대다수가 2다) — 「1,000 AUD」가 아니라 「1,000.00 AUD」다
  assert.equal(formatAmount('100000', 'AUD'), '1,000.00 AUD')
  assert.deepEqual(currencyAffix('AUD'), { prefix: '', suffix: ' AUD' })
})

test('통화를 안 주면 원화로 본다 — 이 저장소의 기본이다', () => {
  assert.equal(formatAmount('1000', null), '1,000원')
  assert.equal(formatAmount('1000', undefined), '1,000원')
})

test('소문자·공백도 받는다 — 저장된 값이 늘 대문자라는 보장이 없다', () => {
  assert.equal(formatAmount('120000', ' usd '), '$1,200.00')
})

test('금액이 없으면 null — 「0원」이라고 단정하지 않는다', () => {
  for (const v of [null, undefined, '']) assert.equal(formatAmount(v, 'KRW'), null)
})

test('안전 정수를 넘으면 원값을 그대로 — 반올림된 거짓 숫자를 보여 주지 않는다', () => {
  const huge = '99999999999999999999'
  assert.equal(formatAmount(huge, 'KRW'), `${huge}원`)
})

test('소수 자릿수는 통화가 정한다', () => {
  assert.equal(minorDigits('KRW'), 0)
  assert.equal(minorDigits('JPY'), 0)
  assert.equal(minorDigits('USD'), 2)
  assert.equal(minorDigits(null), 0)
})

/* ── 사람이 적은 값 → 저장값 (v0.10.86x) ────────── */

/*
  **통화를 고를 수 있게 되면 이 변환이 사고의 입구가 된다.**
  금액 칸은 사람이 친 숫자를 그대로 돌려주는데, 원화는 자리수가 0 이라 그 값이 곧 minor 다.
  달러를 고른 사람이 1080 을 치면 1080 센트($10.80)로 저장된다 — 100분의 1 이다.
*/

test('★ 자리수는 통화가 정한다 — 달러 1080 은 108000 센트다', () => {
  assert.equal(toMinorAmount('1080', 'USD'), '108000')
  assert.equal(toMinorAmount('1080', 'KRW'), '1080', '원에 00 을 붙이면 100배가 된다')
  assert.equal(toMinorAmount('1080', 'JPY'), '1080')
  assert.equal(toMinorAmount('1000', 'AUD'), '100000', '모르는 통화는 두 자리로 본다')
})

test('★ 소수는 문자열로 반올림한다 — 부동소수를 거치면 그 줄만 1원씩 어긋난다', () => {
  assert.equal(toMinorAmount('1080.5', 'USD'), '108050')
  assert.equal(toMinorAmount('1080.57', 'USD'), '108057')
  assert.equal(toMinorAmount('1080.567', 'USD'), '108057')
  assert.equal(toMinorAmount('1080.564', 'USD'), '108056')
})

test('소수가 없는 통화에 소수를 적으면 반올림해서 올린다 — 조용히 버리지 않는다', () => {
  assert.equal(toMinorAmount('1000.6', 'KRW'), '1001')
  assert.equal(toMinorAmount('1000.4', 'KRW'), '1000')
})

test('빈 값은 빈 값이다 — 「0원」이라고 단정하지 않는다', () => {
  for (const v of [null, undefined, '', '  ', '.']) assert.equal(toMinorAmount(v, 'USD'), '')
})

test('★ 왕복해도 같은 금액이다 — 적은 대로 보인다', () => {
  for (const [typed, cur, shown] of [
    ['1080', 'USD', '$1,080.00'],
    ['1080.5', 'USD', '$1,080.50'],
    ['1080', 'KRW', '1,080원'],
  ] as const) {
    assert.equal(formatAmount(toMinorAmount(typed, cur), cur), shown)
  }
})
