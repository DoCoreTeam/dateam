import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeBooked, pickBooked, isCashInflow, countsAsAccountingRevenue, BOOKED_FROM_LABEL,
  needsSeparateAccount, inKindFromFunding, FUNDING_LABEL,
} from './booked-amount.ts'

/** 기획서 §02 의 실례 — 국가 과제 3년 13억 */
const CASE = {
  amountMinor: BigInt(1_300_000_000),
  taxBasis: 'GROSS' as const,
  taxRatePct: 10,
  inKind: [
    { valueMinor: BigInt(180_000_000) }, // 인건비
    { valueMinor: BigInt(60_000_000) },  // 장비사용료
    { valueMinor: BigInt(20_000_000) },  // 시설
  ],
  funding: [
    { sourceType: 'NATIONAL' as const, amountMinor: BigInt(780_000_000) },
    { sourceType: 'LOCAL' as const, amountMinor: BigInt(130_000_000) },
    { sourceType: 'OWN_CASH' as const, amountMinor: BigInt(130_000_000) },
    { sourceType: 'IN_KIND' as const, amountMinor: BigInt(260_000_000) },
  ],
}

test('세 숫자 — 수주 13억 · 현물 제외 10.4억 · 회계 수익 9.1억', () => {
  const r = computeBooked(CASE)
  assert.equal(r.bookedMinor, BigInt(1_300_000_000))
  assert.equal(r.inKindMinor, BigInt(260_000_000))
  assert.equal(r.exInKindMinor, BigInt(1_040_000_000))
  assert.equal(r.accountingRevenueMinor, BigInt(910_000_000))
  assert.equal(r.cashInflowMinor, BigInt(1_040_000_000))
  assert.equal(r.hasInKind, true)
  assert.equal(r.inKindRatioPct, 20)
})

test('자부담 «현금»은 수주 매출에 포함되고 회계 수익에서만 빠진다', () => {
  const r = computeBooked(CASE)
  // 수주 매출 13억 안에 자부담 현금 1.3억이 들어 있다
  assert.equal(r.bookedMinor - r.inKindMinor, BigInt(1_040_000_000))
  // 회계 수익은 국비+지방비 뿐이라 1.3억이 더 빠진다
  assert.equal(r.exInKindMinor - (r.accountingRevenueMinor ?? BigInt(0)), BigInt(130_000_000))
})

test('VAT 는 포함 기준으로 계산된다 — 공급가액 11.8억 · 세액 1.18억', () => {
  const r = computeBooked(CASE)
  assert.equal(r.tax.grossMinor, BigInt(1_300_000_000))
  assert.equal(r.tax.netMinor, BigInt(1_181_818_182))
  assert.equal(r.tax.taxMinor, BigInt(118_181_818))
})

test('현물이 없으면 hasInKind=false — 화면이 «현물 제외»를 안 그린다', () => {
  const r = computeBooked({ amountMinor: BigInt(24_260_000), taxBasis: 'NET', taxRatePct: 10 })
  assert.equal(r.hasInKind, false)
  assert.equal(r.inKindMinor, BigInt(0))
  assert.equal(r.exInKindMinor, r.bookedMinor)
  assert.equal(r.inKindRatioPct, null)
})

test('재원이 없으면 회계 수익은 null — «모른다»와 «0»은 다르다', () => {
  const r = computeBooked({ amountMinor: BigInt(24_260_000) })
  assert.equal(r.accountingRevenueMinor, null)
  assert.equal(r.cashInflowMinor, null)
})

test('금액이 null·빈 문자열이어도 0으로 안전하게 떨어진다', () => {
  for (const v of [null, undefined, '', 0]) {
    const r = computeBooked({ amountMinor: v as never })
    assert.equal(r.bookedMinor, BigInt(0))
    assert.equal(r.inKindRatioPct, null)
  }
})

test('숫자·문자열 금액도 받는다 (Prisma Decimal 대응)', () => {
  const r = computeBooked({ amountMinor: '1300000000', inKind: [{ valueMinor: 260000000 }] })
  assert.equal(r.bookedMinor, BigInt(1_300_000_000))
  assert.equal(r.exInKindMinor, BigInt(1_040_000_000))
})

test('현물이 총액보다 크면 exInKind 가 음수로 나온다 — 막는 것은 I9 의 몫', () => {
  const r = computeBooked({ amountMinor: BigInt(100), inKind: [{ valueMinor: BigInt(300) }] })
  assert.equal(r.exInKindMinor, -BigInt(200))
})

test('재원 성질은 종류에서 파생된다 — 행마다 손으로 넣지 않는다', () => {
  assert.equal(isCashInflow('NATIONAL'), true)
  assert.equal(isCashInflow('LOCAL'), true)
  assert.equal(isCashInflow('OWN_CASH'), true)
  assert.equal(isCashInflow('IN_KIND'), false)

  assert.equal(countsAsAccountingRevenue('NATIONAL'), true)
  assert.equal(countsAsAccountingRevenue('LOCAL'), true)
  assert.equal(countsAsAccountingRevenue('OWN_CASH'), false)
  assert.equal(countsAsAccountingRevenue('IN_KIND'), false)

  // 법령상 별도 계좌 대상은 자부담 현금뿐이다
  assert.equal(needsSeparateAccount('OWN_CASH'), true)
  assert.equal(needsSeparateAccount('NATIONAL'), false)
})

test('재원 라벨이 넷 다 있다', () => {
  assert.equal(FUNDING_LABEL.NATIONAL, '국비')
  assert.equal(FUNDING_LABEL.IN_KIND, '자부담 현물')
  assert.equal(Object.keys(FUNDING_LABEL).length, 4)
})

test('inKindFromFunding — 재원 목록에서 현물만 뽑는다', () => {
  assert.equal(inKindFromFunding(CASE.funding), BigInt(260_000_000))
  assert.equal(inKindFromFunding([]), BigInt(0))
})

test('pickBooked — 계약 > 견적 > 예산 순으로 가장 확실한 것', () => {
  assert.deepEqual(pickBooked({ contractNetMinor: BigInt(3), quotedNetMinor: BigInt(2), budgetNetMinor: BigInt(1) }),
    { minor: BigInt(3), from: 'contract' })
  assert.deepEqual(pickBooked({ quotedNetMinor: BigInt(2), budgetNetMinor: BigInt(1) }),
    { minor: BigInt(2), from: 'quote' })
  assert.deepEqual(pickBooked({ budgetNetMinor: BigInt(1) }),
    { minor: BigInt(1), from: 'budget' })
  assert.deepEqual(pickBooked({}), { minor: BigInt(0), from: 'none' })
  // 0은 «없다»로 본다 — 0원 계약을 실적으로 세지 않는다
  assert.deepEqual(pickBooked({ contractNetMinor: BigInt(0), quotedNetMinor: BigInt(5) }),
    { minor: BigInt(5), from: 'quote' })
})

test('★ 이관 중인 옛 금액 칸을 마지막 폴백으로 본다 — 안 보면 화면의 두 숫자가 서로를 반박한다', () => {
  // 실브라우저에서 잡았다: 속성에는 「1,300,000,000 KRW」가 뜨는데
  // 장부는 「0원 · 금액 미정」이라고 말했다. 딜 폼이 채우는 것은 아직 amountMinor 다.
  assert.deepEqual(
    pickBooked({ amountMinor: BigInt(1_300_000_000) }),
    { minor: BigInt(1_300_000_000), from: 'legacy' },
  )
  assert.equal(BOOKED_FROM_LABEL.legacy, '금액', '사용자에게 «옛 칸»이라고 말하지 않는다')
})

test('옛 칸은 **마지막** 폴백이다 — 새 셋 중 하나라도 있으면 그것을 쓴다', () => {
  assert.equal(pickBooked({ budgetNetMinor: BigInt(1), amountMinor: BigInt(999) }).from, 'budget')
  assert.equal(pickBooked({ quotedNetMinor: BigInt(1), amountMinor: BigInt(999) }).from, 'quote')
  assert.equal(pickBooked({ contractNetMinor: BigInt(1), amountMinor: BigInt(999) }).from, 'contract')
})

test('넷 다 비면 여전히 «금액 미정»이다 — 없는 숫자를 지어내지 않는다', () => {
  assert.deepEqual(pickBooked({}), { minor: BigInt(0), from: 'none' })
})
