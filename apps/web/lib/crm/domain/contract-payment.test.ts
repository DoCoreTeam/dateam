/**
 * 구조화된 대가 — 지급 일정 (P0184 I07)
 *
 *   1 대가 종류 아홉 각각 스키마 검사 — 맞는 예는 지나고, 틀린 예는 거절한다
 *   2 분할 비율 합이 100 이 아니면 거절, 분할 금액의 합은 총액과 같다
 *   3 금액은 정수 최소단위 문자열만, 소수 음수 숫자형 거절
 *   4 {{계약.지급일정}} 칸이 표로 찍히고 금액은 formatAmount 를 지나며 글자는 escape 된다
 *   5 계약서 칸 저장(checkManualFields)이 지급 일정을 검사하고 정리한 글자로 담는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PAYMENT_KINDS, PaymentInputError, checkPaymentPlan, installmentAmounts, parsePaymentValue, paymentValue, renderPaymentSchedule,
} from './contract-payment.ts'
import { fillHtml, fieldByKey, mergeFieldValues } from './contract-fields.ts'
import { checkManualFields } from '../services/contract.ts'
import { CrmError } from './errors.ts'
import { CONTRACT_PAYMENT_MSG } from '../../terms/contract-doc.ts'

const KRW = { currency: 'KRW' }

const VALID: Record<string, Record<string, unknown>> = {
  LUMP: { kind: 'LUMP', ...KRW, amountMinor: '11000000', due: '검수 완료 후 30일 이내' },
  INSTALLMENT: {
    kind: 'INSTALLMENT', ...KRW, totalMinor: '10000000',
    installments: [{ label: '계약금', percent: 30, due: '계약일로부터 7일' }, { label: '잔금', percent: 70, due: '검수 후 30일' }],
  },
  FIXED: { kind: 'FIXED', ...KRW, amountMinor: '2500000', period: 'MONTH', dueDay: 25 },
  USAGE: { kind: 'USAGE', currency: 'USD', unitPriceMinor: '250', unit: 'GPU 시간', period: 'MONTH', minimumMinor: '100000' },
  PREPAID: { kind: 'PREPAID', ...KRW, amountMinor: '5000000', expiresAfterMonths: 12, refund: '기한이 지난 크레딧은 소멸' },
  COMMITMENT: { kind: 'COMMITMENT', ...KRW, committedMinor: '30000000', period: 'YEAR', shortfall: '미달분의 50% 정산' },
  COMMISSION: { kind: 'COMMISSION', ...KRW, ratePercent: 7.5, basis: '공급사 매출액(부가세 제외)' },
  POINT_CONVERSION: { kind: 'POINT_CONVERSION', ...KRW, points: 10000, convertedMinor: '10000', settlement: '전환분은 지자체가 정산' },
  SUBSIDY: { kind: 'SUBSIDY', ...KRW, subsidyMinor: '40000000', ownShareMinor: '10000000', agency: '정보통신산업진흥원' },
}

// ------------------------------------------------------------
// 1 종류 아홉
// ------------------------------------------------------------

test('대가 종류는 아홉이고 각각 맞는 예를 받는다', () => {
  assert.equal(PAYMENT_KINDS.length, 9)
  assert.deepEqual(Object.keys(VALID).sort(), [...PAYMENT_KINDS].sort())
  for (const k of PAYMENT_KINDS) {
    const plan = checkPaymentPlan(VALID[k])
    assert.equal(plan.kind, k)
    assert.notEqual(plan, VALID[k], '정리한 새 객체를 돌려준다')
  }
})

test('종류마다 빠진 칸, 모르는 칸, 틀린 값을 거절한다', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['LUMP', { ...VALID.LUMP, due: ' ' }],
    ['LUMP', { ...VALID.LUMP, extra: 'x' }],
    ['INSTALLMENT', { ...VALID.INSTALLMENT, installments: [{ label: '전액', percent: 100, due: '즉시' }] }],
    ['FIXED', { ...VALID.FIXED, dueDay: 32 }],
    ['FIXED', { ...VALID.FIXED, period: 'WEEK' }],
    ['USAGE', { ...VALID.USAGE, unit: '' }],
    ['PREPAID', { ...VALID.PREPAID, expiresAfterMonths: 0 }],
    ['COMMITMENT', { ...VALID.COMMITMENT, shortfall: undefined }],
    ['COMMISSION', { ...VALID.COMMISSION, ratePercent: 101 }],
    ['COMMISSION', { ...VALID.COMMISSION, ratePercent: 7.555 }],
    ['POINT_CONVERSION', { ...VALID.POINT_CONVERSION, points: 1.5 }],
    ['SUBSIDY', { ...VALID.SUBSIDY, agency: 'x'.repeat(201) }],
    ['SUBSIDY', { ...VALID.SUBSIDY, currency: 'krw' }],
  ]
  for (const [k, input] of bad) assert.throws(() => checkPaymentPlan(input), PaymentInputError, `${k} ${JSON.stringify(input).slice(0, 80)}`)
  assert.throws(() => checkPaymentPlan({ kind: 'BARTER', ...KRW }), (e: unknown) => e instanceof PaymentInputError && e.message === CONTRACT_PAYMENT_MSG.badKind)
  assert.throws(() => checkPaymentPlan(null), PaymentInputError)
})

// ------------------------------------------------------------
// 2 분할
// ------------------------------------------------------------

test('분할 비율 합이 100 이 아니면 거절한다, 소수 둘째 자리까지는 정확히 센다', () => {
  const plan = (ps: number[]) => ({ ...VALID.INSTALLMENT, installments: ps.map((percent, i) => ({ label: `${i + 1}차`, percent, due: '협의' })) })
  assert.throws(() => checkPaymentPlan(plan([30, 60])), (e: unknown) => e instanceof PaymentInputError && e.message === CONTRACT_PAYMENT_MSG.percentSum(90))
  assert.throws(() => checkPaymentPlan(plan([50, 50.01])), PaymentInputError)
  assert.equal(checkPaymentPlan(plan([33.33, 33.33, 33.34])).kind, 'INSTALLMENT')
})

test('분할 금액의 합은 총액과 같다 — 나머지는 마지막 줄이 갖는다', () => {
  const parts = installmentAmounts('10000001', [33.33, 33.33, 33.34])
  assert.deepEqual(parts, ['3333000', '3333000', '3334001'])
  assert.equal(parts.reduce((s, p) => s + BigInt(p), 0n), 10000001n)
})

// ------------------------------------------------------------
// 3 금액
// ------------------------------------------------------------

test('금액은 정수 최소단위 문자열만 받는다', () => {
  for (const amountMinor of ['1000.5', '-1000', 1000, '1e6', '', '1'.repeat(19)]) {
    assert.throws(() => checkPaymentPlan({ ...VALID.LUMP, amountMinor }), PaymentInputError, String(amountMinor))
  }
})

// ------------------------------------------------------------
// 4 인쇄
// ------------------------------------------------------------

test('분할 일정이 표로 찍히고 금액은 통화 표기를 지난다', () => {
  const html = renderPaymentSchedule(checkPaymentPlan(VALID.INSTALLMENT))
  assert.match(html, /^<table>/)
  assert.match(html, /<td>계약금<\/td><td>30%<\/td><td>3,000,000원<\/td><td>계약일로부터 7일<\/td>/)
  assert.match(html, /<td>합계<\/td><td>100%<\/td><td>10,000,000원<\/td>/)
  assert.match(renderPaymentSchedule(checkPaymentPlan(VALID.USAGE)), /\$2\.50 \/ GPU 시간/)
})

test('모든 종류가 표를 그린다', () => {
  for (const k of PAYMENT_KINDS) assert.match(renderPaymentSchedule(checkPaymentPlan(VALID[k])), /^<table>.*<\/table>$/, k)
})

test('글자 칸은 escape 된다', () => {
  const html = renderPaymentSchedule(checkPaymentPlan({ ...VALID.LUMP, due: '<script>alert(1)</script>' }))
  assert.ok(!html.includes('<script>'))
  assert.match(html, /&lt;script&gt;/)
})

test('{{계약.지급일정}} 칸이 문단 자리에서는 표로, 글 속에서는 대가 종류로 찍히고, 비면 미입력으로 드러난다', () => {
  assert.equal(fieldByKey('contract.payment')?.kind, 'payment')
  const values = mergeFieldValues({}, { 'contract.payment': paymentValue(checkPaymentPlan(VALID.LUMP)) })
  const out = fillHtml('<p>{{계약.지급일정}}</p><p>대가는 {{계약.지급일정}} 으로 한다</p>', values, null)
  assert.match(out, /^<table>.*11,000,000원.*<\/table><p>대가는 일시 지급 으로 한다<\/p>$/)
  const empty = fillHtml('<p>{{계약.지급일정}}</p>', mergeFieldValues({}, {}), null)
  assert.match(empty, /field-empty/)
})

// ------------------------------------------------------------
// 5 저장 검사
// ------------------------------------------------------------

test('계약서 칸 저장이 지급 일정을 검사하고 정리한 글자로 담는다, 같은 일정은 같은 글자', () => {
  const a = checkManualFields({ 'contract.payment': JSON.stringify(VALID.INSTALLMENT) })['contract.payment']
  const reordered = { installments: VALID.INSTALLMENT.installments, totalMinor: '10000000', currency: 'KRW', kind: 'INSTALLMENT' }
  const b = checkManualFields({ 'contract.payment': JSON.stringify(reordered) })['contract.payment']
  assert.equal(a, b)
  assert.deepEqual(parsePaymentValue(a), checkPaymentPlan(VALID.INSTALLMENT))
  assert.throws(() => checkManualFields({ 'contract.payment': '{"kind":"LUMP"}' }), (e: unknown) => e instanceof CrmError && e.code === 'VALIDATION_FAILED')
  assert.throws(() => checkManualFields({ 'contract.payment': 'not json' }), (e: unknown) => e instanceof CrmError && e.code === 'VALIDATION_FAILED')
  assert.equal(checkManualFields({ 'contract.payment': '' })['contract.payment'], '', '빈 값은 칸을 비운다')
})
