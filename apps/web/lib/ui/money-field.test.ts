// 금액 입력 SSOT — 화면 7곳이 같은 부품을 쓴다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digitsOnly, groupDigits } from './money-format.ts'

test('보이는 값에 천단위가 들어간다 — 「300000000」은 3억인지 30억인지 세어야 한다', () => {
  assert.equal(groupDigits('300000000'), '300,000,000')
  assert.equal(groupDigits('1000'), '1,000')
  assert.equal(groupDigits('999'), '999')
  assert.equal(groupDigits(''), '')
})

test('저장되는 값에는 쉼표가 없다 — 섞여 들어가면 금액이 통째로 틀어진다', () => {
  assert.equal(digitsOnly('300,000,000'), '300000000')
  assert.equal(digitsOnly('3억'), '3')
  assert.equal(digitsOnly('1 000 000'), '1000000')
})

test('소수를 받는 통화는 소수점 하나만 — 「1.2.3」이 저장되면 계산이 깨진다', () => {
  assert.equal(digitsOnly('1.2.3', true), '1.23')
  assert.equal(digitsOnly('12.34', true), '12.34')
  assert.equal(digitsOnly('12.34', false), '1234')
})

test('소수부에는 쉼표를 넣지 않는다', () => {
  assert.equal(groupDigits('1234567.89'), '1,234,567.89')
})

test('0 은 값이다 — 무상 제공 항목이 0원으로 들어간다', () => {
  assert.equal(groupDigits('0'), '0')
  assert.equal(digitsOnly('0'), '0')
})

test('아주 큰 금액도 그대로 — 숫자로 바꾸지 않으니 정밀도가 안 깨진다', () => {
  const huge = '99999999999999999999'
  assert.equal(digitsOnly(groupDigits(huge)), huge)
})
