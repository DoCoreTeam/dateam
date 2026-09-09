import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatValue } from './format-value.ts'
import { RFP_REPORT, RFP_COMMON } from '../terms.ts'

test('★ 값이 있는데 빈칸을 그리지 않는다 — 실측: 사업예산 309,969,445원이 빈칸으로 보였다', () => {
  const out = formatValue({ amount: '309,969,445', unit: '원' })
  assert.notEqual(out, '')
  assert.notEqual(out, RFP_REPORT.noValue)
  assert.ok(out.includes('309,969,445'))
  assert.ok(out.includes('원'))
})

test('이름 계열이 먼저다', () => {
  assert.equal(formatValue({ name: '사업명', amount: 1 }), '사업명')
  assert.equal(formatValue({ title: '제목' }), '제목')
})

test('못 읽는 모양이어도 가진 것을 보여 준다 — 빈칸보다 낫다', () => {
  const out = formatValue({ 알수없는칸: '어떤 값' })
  assert.ok(out.includes('어떤 값'))
})

test('빈 객체만 「못 찾음」이다', () => {
  assert.equal(formatValue({}), RFP_REPORT.noValue)
  assert.equal(formatValue(null), RFP_REPORT.noValue)
})

test('배열은 읽을 수 있는 것만 이어 붙인다', () => {
  assert.equal(formatValue(['가', { name: '나' }, {}]), '가, 나')
  assert.equal(formatValue([]), RFP_REPORT.noValue)
})

test('참·거짓은 사람 말로', () => {
  assert.equal(formatValue(true), RFP_COMMON.yes)
  assert.equal(formatValue(false), RFP_COMMON.no)
})

test('숫자는 자릿점을 찍는다', () => {
  assert.equal(formatValue(309969445), '309,969,445')
})
