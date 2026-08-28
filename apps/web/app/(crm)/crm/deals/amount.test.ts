// 금액 표시 SSOT — 보드·표·장부·견적서가 **같은 함수**를 쓴다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAmount, minorDigits, currencyAffix } from './amount.ts'

test('원화는 「원」을 뒤에 붙인다 — 한국어 문서에 KRW 라고 쓰는 곳은 없다', () => {
  assert.equal(formatAmount('548375000', 'KRW'), '548,375,000원')
  assert.equal(formatAmount('0', 'KRW'), '0원')
})

test('달러·유로는 기호를 앞에 — 「1,000 USD」도 사람이 쓰는 말이 아니다', () => {
  assert.equal(formatAmount('120000', 'USD'), '$1,200')
  assert.equal(formatAmount('123456', 'EUR'), '€1,234.56')
})

test('엔화는 소수가 없고 「엔」이 뒤에', () => {
  assert.equal(formatAmount('1000', 'JPY'), '1,000엔')
})

test('모르는 통화는 코드를 그대로 뒤에 — 지어내지 않는다', () => {
  assert.equal(formatAmount('100000', 'AUD'), '1,000 AUD')
  assert.deepEqual(currencyAffix('AUD'), { prefix: '', suffix: ' AUD' })
})

test('통화를 안 주면 원화로 본다 — 이 저장소의 기본이다', () => {
  assert.equal(formatAmount('1000', null), '1,000원')
  assert.equal(formatAmount('1000', undefined), '1,000원')
})

test('소문자·공백도 받는다 — 저장된 값이 늘 대문자라는 보장이 없다', () => {
  assert.equal(formatAmount('120000', ' usd '), '$1,200')
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
