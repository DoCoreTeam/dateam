// lib/crm/domain/quote-rate-text.test.ts — 고른 것이 **실제로 글이 되는지** 보는 가드
//
// 화면·인쇄·엑셀 셋이 이 파일 하나에서 글을 받는다. 그래서 여기가 빈 목록을 돌려주면
// 세 군데가 한꺼번에 조용해진다 — 사용자는 체크를 했는데 아무 데서도 안 보인다.
// 실측 2026-10-05: 날짜를 안 적은 품목에서 **고른 기간 총액까지** 같이 사라졌다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  axisTexts, lineNoteText, convTexts, approxText, hoursText,
  durationText, hourlyBasisText,
} from './quote-rate-text.ts'
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

test('★ 시간 축이 없는 줄에는 기간 총액도 안 붙는다 — 없는 기간을 이름으로 말하지 않는다', () => {
  /*
    「식 1개 500,000원」 아래 「기간 총액 500,000원」이 서면 그 줄에 없는 기간을
    있는 것처럼 말하고, 같은 숫자를 두 번 적는 군더더기까지 된다
    (실측 2026-10-05, 「식」과 「Hours」가 섞인 견적).
  */
  assert.deepEqual(axisTexts(line({ rate: null }), ['total'], money), [])
  assert.deepEqual(axisTexts(line({ rate: null }), ['total', 'monthly', 'hourly'], money), [])
})

test('★ 날짜가 없어도 수량이 센 축이 있으면 기간 총액이 선다 — 어제 고친 것이 안 깨진다', () => {
  // RATE 는 start·end 가 null 이고 totalHours 만 1,440 인 축이다
  const out = axisTexts(line(), ['total'], money)
  assert.equal(out.length, 1, '수량이 센 줄에서 기간 총액이 사라졌다')
  assert.equal(out[0].key, 'total')
  assert.equal(out[0].body, '1,998,720원')
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

/* ──────────────────────────────────────────────────────────────────────────
   기간 축 — 「× 2개월」과 「17대 기준」

   실측 2026-10-06: 17대를 2개월 쓰는 견적에서 2개월이 사라져 금액이 절반이 됐다.
   돌아온 뒤에는 **그 두 축이 문서에 보여야** 고객이 금액을 따라갈 수 있다.
   ────────────────────────────────────────────────────────────────────────── */

test('★ 기간은 곱셈 기호를 달고 선다 — 「2개월」만 적으면 수량의 설명으로 읽힌다', () => {
  assert.equal(durationText({ value: '2', unit: 'MONTH' }), '× 2개월')
  assert.equal(durationText({ value: '30', unit: 'DAY' }), '× 30일')
  assert.equal(durationText({ value: '1460', unit: 'HOUR' }), '× 1,460시간')
  assert.equal(durationText({ value: '1', unit: 'YEAR' }), '× 1년')
})

test('★ 안 적었거나 모르는 단위면 그 자리를 안 그린다 — 지어내서 인쇄하지 않는다', () => {
  assert.equal(durationText(null), '')
  assert.equal(durationText(undefined), '')
  assert.equal(durationText({ value: '2', unit: 'WEEK' }), '')
})

test('★ 시간당 금액은 몇 대 기준인지를 이름에 적는다 — 한 대당으로 읽으면 열일곱 배 틀린다', () => {
  assert.equal(hourlyBasisText(17, '대'), ' (17대 기준)')
  assert.equal(hourlyBasisText('17', '대'), ' (17대 기준)')
  assert.equal(hourlyBasisText(2, null), ' (2 기준)')
})

test('★ 수량 칸이 곧 시간인 줄에는 안 붙는다 — 「1,440Hours 기준」은 뜻이 없다', () => {
  /*
    「1,440 Hours」짜리 줄의 시간당은 금액 ÷ 1,440h 이고 그 1,440 이 바로 수량이다.
    수량이 금액에 한 번 더 곱해지지 않으므로 기준을 말할 것이 없다.
  */
  assert.equal(hourlyBasisText(1440, 'Hours'), '')
  assert.equal(hourlyBasisText(48, '시간'), '')
  assert.equal(hourlyBasisText(100, 'h'), '')
})

test('★ 한 대짜리 줄에는 안 붙는다 — 「1대 기준」은 없는 구별을 있는 것처럼 보이게 한다', () => {
  assert.equal(hourlyBasisText(1, '대'), '')
  assert.equal(hourlyBasisText(0, '대'), '')
  assert.equal(hourlyBasisText('이상한 값', '대'), '')
})
