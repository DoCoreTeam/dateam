import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeBooked, pickBooked, isCashInflow, countsAsAccountingRevenue,
  needsSeparateAccount, inKindFromFunding, FUNDING_LABEL,
} from './booked-amount.ts'

/** 기획서 §02 의 실례 — 국가 과제 3년 13억 */
const CASE = {
  amountMinor: 1_300_000_000n,
  taxBasis: 'GROSS' as const,
  taxRatePct: 10,
  inKind: [
    { valueMinor: 180_000_000n }, // 인건비
    { valueMinor: 60_000_000n },  // 장비사용료
    { valueMinor: 20_000_000n },  // 시설
  ],
  funding: [
    { sourceType: 'NATIONAL' as const, amountMinor: 780_000_000n },
    { sourceType: 'LOCAL' as const, amountMinor: 130_000_000n },
    { sourceType: 'OWN_CASH' as const, amountMinor: 130_000_000n },
    { sourceType: 'IN_KIND' as const, amountMinor: 260_000_000n },
  ],
}

test('세 숫자 — 수주 13억 · 현물 제외 10.4억 · 회계 수익 9.1억', () => {
  const r = computeBooked(CASE)
  assert.equal(r.bookedMinor, 1_300_000_000n)
  assert.equal(r.inKindMinor, 260_000_000n)
  assert.equal(r.exInKindMinor, 1_040_000_000n)
  assert.equal(r.accountingRevenueMinor, 910_000_000n)
  assert.equal(r.cashInflowMinor, 1_040_000_000n)
  assert.equal(r.hasInKind, true)
  assert.equal(r.inKindRatioPct, 20)
})

test('자부담 «현금»은 수주 매출에 포함되고 회계 수익에서만 빠진다', () => {
  const r = computeBooked(CASE)
  // 수주 매출 13억 안에 자부담 현금 1.3억이 들어 있다
  assert.equal(r.bookedMinor - r.inKindMinor, 1_040_000_000n)
  // 회계 수익은 국비+지방비 뿐이라 1.3억이 더 빠진다
  assert.equal(r.exInKindMinor - (r.accountingRevenueMinor ?? 0n), 130_000_000n)
})

test('VAT 는 포함 기준으로 계산된다 — 공급가액 11.8억 · 세액 1.18억', () => {
  const r = computeBooked(CASE)
  assert.equal(r.tax.grossMinor, 1_300_000_000n)
  assert.equal(r.tax.netMinor, 1_181_818_182n)
  assert.equal(r.tax.taxMinor, 118_181_818n)
})

test('현물이 없으면 hasInKind=false — 화면이 «현물 제외»를 안 그린다', () => {
  const r = computeBooked({ amountMinor: 24_260_000n, taxBasis: 'NET', taxRatePct: 10 })
  assert.equal(r.hasInKind, false)
  assert.equal(r.inKindMinor, 0n)
  assert.equal(r.exInKindMinor, r.bookedMinor)
  assert.equal(r.inKindRatioPct, null)
})

test('재원이 없으면 회계 수익은 null — «모른다»와 «0»은 다르다', () => {
  const r = computeBooked({ amountMinor: 24_260_000n })
  assert.equal(r.accountingRevenueMinor, null)
  assert.equal(r.cashInflowMinor, null)
})

test('금액이 null·빈 문자열이어도 0으로 안전하게 떨어진다', () => {
  for (const v of [null, undefined, '', 0]) {
    const r = computeBooked({ amountMinor: v as never })
    assert.equal(r.bookedMinor, 0n)
    assert.equal(r.inKindRatioPct, null)
  }
})

test('숫자·문자열 금액도 받는다 (Prisma Decimal 대응)', () => {
  const r = computeBooked({ amountMinor: '1300000000', inKind: [{ valueMinor: 260000000 }] })
  assert.equal(r.bookedMinor, 1_300_000_000n)
  assert.equal(r.exInKindMinor, 1_040_000_000n)
})

test('현물이 총액보다 크면 exInKind 가 음수로 나온다 — 막는 것은 I9 의 몫', () => {
  const r = computeBooked({ amountMinor: 100n, inKind: [{ valueMinor: 300n }] })
  assert.equal(r.exInKindMinor, -200n)
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
  assert.equal(inKindFromFunding(CASE.funding), 260_000_000n)
  assert.equal(inKindFromFunding([]), 0n)
})

test('pickBooked — 계약 > 견적 > 예산 순으로 가장 확실한 것', () => {
  assert.deepEqual(pickBooked({ contractNetMinor: 3n, quotedNetMinor: 2n, budgetNetMinor: 1n }),
    { minor: 3n, from: 'contract' })
  assert.deepEqual(pickBooked({ quotedNetMinor: 2n, budgetNetMinor: 1n }),
    { minor: 2n, from: 'quote' })
  assert.deepEqual(pickBooked({ budgetNetMinor: 1n }),
    { minor: 1n, from: 'budget' })
  assert.deepEqual(pickBooked({}), { minor: 0n, from: 'none' })
  // 0은 «없다»로 본다 — 0원 계약을 실적으로 세지 않는다
  assert.deepEqual(pickBooked({ contractNetMinor: 0n, quotedNetMinor: 5n }),
    { minor: 5n, from: 'quote' })
})
