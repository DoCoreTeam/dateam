/**
 * 말로 채우기 지시 가드
 *
 * **왜 지은 결과를 보나**: 이 파일의 머리말과 주석은 옛 문장을 인용할 때가 있어,
 * 파일 글자를 훑으면 그 인용이 걸려 가드가 거짓으로 통과한다.
 * 모델이 실제로 받는 것은 `build()` 가 지은 글이므로 그것만 본다.
 *
 * **왜 이 파일이 생겼나**: 파일 길(`quote-from-doc`)에는 지시 가드가 있는데 말 길에는 없었다.
 * 그래서 「17대 × 2개월」을 담는 축을 더하면서 **파일 길만 고치고 말 길은 빠뜨렸다** —
 * 「H100 2대를 3개월」을 적으면 3개월이 그대로 사라졌다(실측 2026-10-06).
 * 같은 일이 두 입구로 들어오는데 가드가 한쪽에만 있으면 그 한쪽만 자란다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { QUOTE_DRAFT_V1 } from './quote-draft.v1.ts'
import { QuoteDraftOutputSchema } from '../schemas/quote-draft.ts'

/** 모델이 실제로 받는 글 */
const BUILT = QUOTE_DRAFT_V1.build('원문자리')

test('판이 v1.3.0 으로 올랐다 — 지시를 바꿨는데 판이 그대로면 무엇이 도는지 알 수 없다', () => {
  // v1.3.0 에서 「얼마 동안」을 읽는 법을 더했다(2026-10-06)
  assert.equal(QUOTE_DRAFT_V1.version, 'quote_draft@v1.3.0')
})

test('원문이 지시 안에 실린다 — 안 실리면 모델은 빈 글을 읽는다', () => {
  assert.ok(BUILT.includes('원문자리'), '원문이 안 들어갔다')
})

test('★ 기간이 수량과 다른 축이라고 말한다', () => {
  assert.match(BUILT, /「얼마 동안」은 수량과 다른 축이다/)
  assert.match(BUILT, /durationValue 3 · durationUnit "MONTH"/)
  assert.match(BUILT, /HOUR·DAY·MONTH·YEAR/)
})

test('★ 수량 칸을 기간으로 적지 말라고 말한다 — 「2대」는 두 대이지 두 달이 아니다', () => {
  assert.match(BUILT, /수량 칸의 숫자를 기간으로 적지 마라\.\*\* 「2대」는/)
  assert.match(BUILT, /두 대이지 두 달이 아니다/)
})

test('★ 안 말했으면 null 이라고 말한다 — 지어내면 그 줄의 금액이 거짓이 된다', () => {
  assert.match(BUILT, /기간을 안 말했으면 \*\*둘 다 null\*\* 이다/)
})

/* ── 스키마가 실제로 그 모양을 받나 ─────────────────────────────────────── */

const base = {
  title: null, currency: null, customerName: null,
  targetTotalMinor: null, targetIncludesTax: false, taxPercent: null,
  roundingUnit: null, unclear: [],
}
const line = {
  name: 'H100 80GB', spec: null, components: [], remark: null,
  kind: 'QUANTITY', quantity: 2, unit: '대',
  unitPriceMinor: 45_000_000, discountPercent: null, specialDiscountPercent: null,
}

test('★ 「H100 2대를 3개월」 모양이 통과한다', () => {
  const r = QuoteDraftOutputSchema.parse({
    ...base,
    lines: [{ ...line, durationValue: 3, durationUnit: 'MONTH' }],
  })
  assert.equal(r.lines[0].quantity, 2)
  assert.equal(r.lines[0].unit, '대')
  assert.equal(r.lines[0].durationValue, 3)
  assert.equal(r.lines[0].durationUnit, 'MONTH')
})

test('★ 원문 말을 그대로 적어도 읽는다 — 파일 길과 **같은 코드**를 쓴다', () => {
  const unitOf = (v: unknown) =>
    QuoteDraftOutputSchema.parse({ ...base, lines: [{ ...line, durationValue: 3, durationUnit: v }] })
      .lines[0].durationUnit
  assert.equal(unitOf('개월'), 'MONTH')
  assert.equal(unitOf('months'), 'MONTH')
  assert.equal(unitOf('3개월'), 'MONTH', '수가 붙어 와도 말만 떼어 읽는다')
  assert.equal(unitOf('년'), 'YEAR')
  assert.equal(unitOf('주'), null, '주는 월 환산이 안 떨어져 안 받는다')
})

test('★ 안 말했으면 null 이다 — 1 로 눕히면 「한 달짜리」라고 단정하는 것이다', () => {
  const r = QuoteDraftOutputSchema.parse({ ...base, lines: [line] })
  assert.equal(r.lines[0].durationValue, null)
  assert.equal(r.lines[0].durationUnit, null)
})
