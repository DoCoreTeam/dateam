// lib/crm/domain/quote-rate-text.test.ts — 고른 것이 **실제로 글이 되는지** 보는 가드
//
// 화면·인쇄·엑셀 셋이 이 파일 하나에서 글을 받는다. 그래서 여기가 빈 목록을 돌려주면
// 세 군데가 한꺼번에 조용해진다 — 사용자는 체크를 했는데 아무 데서도 안 보인다.
// 실측 2026-10-05: 날짜를 안 적은 품목에서 **고른 기간 총액까지** 같이 사라졌다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { axisTexts, lineNoteText, convTexts, approxText, hoursText } from './quote-rate-text.ts'
import type { DocumentLine, DocumentLineRate } from './quote-document.ts'

const money = (m: string) => `${Number(m).toLocaleString('ko-KR')}원`

/** 환산이 실린 품목 하나 — 1,440시간 1,388원, 720 기준 2개월 */
const RATE: DocumentLineRate = {
  start: null, end: null, months: 2, days: null, totalHours: 1440,
  monthlyMinor: '999360', hourlyMinor: '1388', hourlyExact: true, hoursPerMonth: 720,
}

function line(over: Partial<DocumentLine> = {}): DocumentLine {
  return {
    no: 1, sectionId: null, name: '1× NVIDIA L40S PCIe', spec: null, components: [],
    unit: 'Hours', quantity: '1440', unitPriceMinor: '1388',
    discountPercent: '0', isSpecialDiscount: false, baseDiscountPercent: '0',
    specialDiscountPercent: '', baseAmountMinor: '1998720', amountMinor: '1998720',
    remark: null, rate: RATE,
    ...over,
  }
}

/* ── 기간 총액 ───────────────────────────────── */

test('★ 환산이 없어도 기간 총액은 선다 — 그 값은 금액 칸의 숫자 그 자체다', () => {
  const out = axisTexts(line({ rate: null }), ['total'], money)
  assert.equal(out.length, 1, '고른 기간 총액이 사라졌다')
  assert.equal(out[0].key, 'total')
  assert.equal(out[0].body, '1,998,720원')
})

test('★ 환산이 없으면 월 금액과 시간당은 안 적는다 — 모르는 것을 지어내지 않는다', () => {
  const out = axisTexts(line({ rate: null }), ['total', 'monthly', 'hourly'], money)
  assert.deepEqual(out.map((a) => a.key), ['total'])
})

test('★ 아무것도 안 고르면 빈 목록이다 — 지금까지와 같은 금액 칸이다', () => {
  assert.deepEqual(axisTexts(line(), [], money), [])
  assert.deepEqual(axisTexts(line({ rate: null }), [], money), [])
})

/* ── 곱셈식 ──────────────────────────────────── */

test('★ 고른 축 셋이 다 글이 된다', () => {
  const out = axisTexts(line(), ['total', 'monthly', 'hourly'], money)
  assert.deepEqual(out.map((a) => a.key), ['total', 'monthly', 'hourly'], '용어집 차례로 선다')
  assert.equal(out[1].body, '999,360원 × 2개월')
  assert.equal(out[2].body, '1,388원 × 1,440h', '딱 떨어지는데 「약」이 붙었다')
})

test('★ 곱해서 합계로 안 돌아오면 「약」이 붙는다', () => {
  const r: DocumentLineRate = {
    ...RATE, totalHours: 1460, hourlyMinor: '1369', hourlyExact: false, hoursPerMonth: 730,
  }
  const out = axisTexts(line({ rate: r }), ['monthly', 'hourly'], money)
  assert.equal(out[0].body, '999,360원 × 2개월', '딱 떨어지는 월 금액에 「약」이 붙었다')
  assert.equal(out[1].body, '약 1,369원 × 1,460h')
})

test('★ 개월을 모르면 월 금액 줄이 안 생긴다', () => {
  const out = axisTexts(line({ rate: { ...RATE, months: null, monthlyMinor: null } }),
    ['monthly', 'hourly'], money)
  assert.deepEqual(out.map((a) => a.key), ['hourly'])
})

/* ── 품목 아래 근거 ──────────────────────────── */

test('★ 날짜를 안 적었으면 기간 근거는 안 적고 나머지는 적는다', () => {
  const t = lineNoteText(line(), ['period', 'totalHours', 'hoursBasis'], money)
  assert.equal(t, '총 시간 1,440h · 월 기준 시간 720h')
})

test('★ 날짜를 적었으면 기간 근거가 맨 앞에 선다', () => {
  const r = { ...RATE, start: '2026-10-07', end: '2026-12-06' }
  const t = lineNoteText(line({ rate: r }), ['period', 'totalHours', 'hoursBasis'], money)
  assert.equal(t, '기간 2026-10-07 ~ 2026-12-06 · 총 시간 1,440h · 월 기준 시간 720h')
})

test('★ 환산이 없으면 근거 줄 자체가 빈 문자열이다', () => {
  assert.equal(lineNoteText(line({ rate: null }), ['period', 'totalHours', 'hoursBasis'], money), '')
})

test('★ 정상가와 할인은 특별 할인일 때만 적는다', () => {
  const on = line({ isSpecialDiscount: true, baseAmountMinor: '2498400', discountPercent: '20' })
  assert.equal(lineNoteText(on, ['wasAndDiscount'], money), '정상가 2,498,400원 · 20%')
  assert.equal(lineNoteText(line(), ['wasAndDiscount'], money), '', '특별 할인이 아닌데 적었다')
})

/* ── 합계 환산 ───────────────────────────────── */

test('★ 합계 환산 줄은 근거를 달고 선다', () => {
  const out = convTexts(
    { monthlyMinor: '999360', months: 2, hourlyMinor: '1388', hourlyExact: true,
      totalHours: 1440, hoursPerMonth: 720 },
    ['monthly', 'hourly'], '1998720', money,
  )
  assert.deepEqual(out.map((c) => c.key), ['monthly', 'hourly'])
  assert.equal(out[0].amount, '999,360원')
  assert.deepEqual(out[0].basis, ['2개월'])
  assert.equal(out[1].amount, '1,388원')
  assert.deepEqual(out[1].basis, ['월 기준 시간 720h', '총 시간 1,440h'])
})

test('★ 문서가 환산을 안 주면 합계에 줄이 안 생긴다', () => {
  assert.deepEqual(convTexts(null, ['monthly', 'hourly'], '1998720', money), [])
})

/* ── 조각들 ──────────────────────────────────── */

test('★ 시간 글자는 천 단위로 끊고 h 를 붙인다', () => {
  assert.equal(hoursText(1440), '1,440h')
  assert.equal(hoursText(720), '720h')
})

test('★ 「약」은 곱해서 합계로 안 돌아올 때만 붙는다', () => {
  assert.equal(approxText('1388', 1440, '1998720', money), '1,388원')
  assert.equal(approxText('1369', 1460, '1998720', money), '약 1,369원')
  assert.equal(approxText(null, 2, '1998720', money), null)
  assert.equal(approxText('999360', null, '1998720', money), null)
})
