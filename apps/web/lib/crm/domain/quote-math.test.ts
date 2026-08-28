import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLine, computeTotals, discountRateOf, needsApproval,
  formatQuoteNo, seqOfQuoteNo, isExpired, DEFAULT_DISCOUNT_APPROVAL_PCT,
} from './quote-math.ts'

test('한 줄: 수량 × 단가 → 할인 → 세금 순서로 계산한다', () => {
  const a = computeLine({ quantity: 3, unitPriceMinor: 1_000_000, discountPercent: 10, taxRate: 10 })
  assert.equal(a.grossMinor, BigInt(3_000_000))
  assert.equal(a.discountMinor, BigInt(300_000))
  assert.equal(a.lineTotalMinor, BigInt(2_700_000))
  assert.equal(a.taxMinor, BigInt(270_000))
})

test('★ 수량을 먼저 곱한다 — 단가에 먼저 할인하면 오차가 수량만큼 증폭된다', () => {
  // 단가 333원 × 3개 = 999원, 여기서 10% = 99.9 → 100원
  // 반대로 하면 333×0.1=33.3→33, ×3 = 99원. 1원이 어긋난다.
  const a = computeLine({ quantity: 3, unitPriceMinor: 333, discountPercent: 10 })
  assert.equal(a.grossMinor, BigInt(999))
  assert.equal(a.discountMinor, BigInt(100))
  assert.equal(a.lineTotalMinor, BigInt(899))
})

test('소수 수량(0.5식·1.5개월)도 정수 금액으로 떨어진다', () => {
  const a = computeLine({ quantity: 1.5, unitPriceMinor: 1_000_000 })
  assert.equal(a.grossMinor, BigInt(1_500_000))
  assert.equal(a.lineTotalMinor, BigInt(1_500_000))
})

test('할인율·세율은 0~100 으로 접는다 — 범위 밖 값이 음수 금액을 만들지 않는다', () => {
  const over = computeLine({ quantity: 1, unitPriceMinor: 1000, discountPercent: 150 })
  assert.equal(over.discountMinor, BigInt(1000))
  assert.equal(over.lineTotalMinor, BigInt(0), '100% 를 넘어도 음수가 되지 않는다')

  const under = computeLine({ quantity: 1, unitPriceMinor: 1000, discountPercent: -50 })
  assert.equal(under.discountMinor, BigInt(0))
  assert.equal(under.lineTotalMinor, BigInt(1000))
})

test('할인율·세율을 안 주면 0으로 본다 — 없는 값을 지어내지 않는다', () => {
  const a = computeLine({ quantity: 2, unitPriceMinor: 500 })
  assert.equal(a.discountMinor, BigInt(0))
  assert.equal(a.taxMinor, BigInt(0))
  assert.equal(a.lineTotalMinor, BigInt(1000))
})

test('Prisma Decimal 이 문자열로 와도 같은 값이 나온다', () => {
  const fromString = computeLine({ quantity: '3', unitPriceMinor: '1000000', discountPercent: '10', taxRate: '10' })
  const fromNumber = computeLine({ quantity: 3, unitPriceMinor: 1_000_000, discountPercent: 10, taxRate: 10 })
  assert.deepEqual(fromString, fromNumber)
})

test('쓰레기 입력은 0으로 떨어진다 — 예외로 견적 화면이 죽지 않는다', () => {
  const a = computeLine({ quantity: 'abc' as unknown as number, unitPriceMinor: 'xyz' })
  assert.equal(a.grossMinor, BigInt(0))
  assert.equal(a.lineTotalMinor, BigInt(0))
})

test('★ 총액은 줄 합계의 합이다 — 화면의 줄과 총액이 서로를 반박하면 안 된다', () => {
  const lines = [
    { quantity: 3, unitPriceMinor: 1_000_000, discountPercent: 10, taxRate: 10 },
    { quantity: 1, unitPriceMinor: 500_000, taxRate: 10 },
  ]
  const t = computeTotals(lines)

  const sumOfLines = lines.reduce((acc, l) => acc + computeLine(l).lineTotalMinor, BigInt(0))
  assert.equal(t.subtotalMinor - t.discountMinor, sumOfLines)

  assert.equal(t.subtotalMinor, BigInt(3_500_000))
  assert.equal(t.discountMinor, BigInt(300_000))
  assert.equal(t.taxMinor, BigInt(270_000 + 50_000))
  assert.equal(t.totalMinor, BigInt(3_500_000 - 300_000 + 320_000))
})

test('항목이 없으면 전부 0 — 빈 견적도 계산은 성립한다', () => {
  const t = computeTotals([])
  assert.equal(t.subtotalMinor, BigInt(0))
  assert.equal(t.totalMinor, BigInt(0))
})

test('전체 할인율: 소계가 0이면 0으로 본다 (0으로 나누지 않는다)', () => {
  assert.equal(discountRateOf({ subtotalMinor: BigInt(0), discountMinor: BigInt(0) }), 0)
  assert.equal(discountRateOf({ subtotalMinor: BigInt(1000), discountMinor: BigInt(200) }), 20)
})

test('★ 임계를 넘는 할인은 승인이 필요하다 — 경계에서는 필요 없다', () => {
  const at = { subtotalMinor: BigInt(1000), discountMinor: BigInt(150) }   // 정확히 15%
  const over = { subtotalMinor: BigInt(1000), discountMinor: BigInt(151) } // 15.1%
  assert.equal(needsApproval(at), false, '임계와 같으면 통과 — 초과할 때만 막는다')
  assert.equal(needsApproval(over), true)
})

test('임계는 워크스페이스가 바꿀 수 있다 — 기본값은 15%', () => {
  assert.equal(DEFAULT_DISCOUNT_APPROVAL_PCT, 15)
  const d = { subtotalMinor: BigInt(1000), discountMinor: BigInt(300) } // 30%
  assert.equal(needsApproval(d, 50), false, '임계를 올리면 통과한다')
  assert.equal(needsApproval(d, 5), true, '임계를 내리면 막힌다')
})

test('견적 번호는 사람이 전화로 부를 수 있는 모양이다', () => {
  assert.equal(formatQuoteNo(2026, 7), 'Q-2026-0007')
  assert.equal(formatQuoteNo(2026, 1234), 'Q-2026-1234')
})

test('번호에서 순번을 되읽는다 — 해가 바뀌면 1부터 다시 센다', () => {
  assert.equal(seqOfQuoteNo('Q-2026-0007', 2026), 7)
  assert.equal(seqOfQuoteNo('Q-2025-0099', 2026), 0, '지난해 번호는 올해 순번이 아니다')
  assert.equal(seqOfQuoteNo('이상한값', 2026), 0)
  assert.equal(seqOfQuoteNo(null, 2026), 0)
})

test('유효기간은 읽는 시점에 판정한다 — 배치가 실패해도 만료가 유효해 보이지 않는다', () => {
  const now = new Date('2026-08-17T00:00:00Z')
  assert.equal(isExpired('2026-08-16T23:59:59Z', now), true)
  assert.equal(isExpired('2026-08-17T00:00:01Z', now), false)
  assert.equal(isExpired(null, now), false, '기간을 안 정한 견적은 만료되지 않는다')
  assert.equal(isExpired('깨진값', now), false, '판정 불가를 만료로 치지 않는다')
})

test('특별 할인은 기본 할인 «위에» 겹쳐 적용된다', () => {
  // 사용자 지시의 실제 예: 1억 · 기본 30% · 특별 80%
  const a = computeLine({
    quantity: 1, unitPriceMinor: 100_000_000,
    discountPercent: 30, specialDiscountPercent: 80, taxRate: 10,
  })
  assert.equal(a.grossMinor, BigInt(100_000_000))
  assert.equal(a.baseLineTotalMinor, BigInt(70_000_000))   // 기본만 적용했다면
  assert.equal(a.lineTotalMinor, BigInt(14_000_000))       // 그 위에 특별 80%
  assert.equal(a.discountMinor, BigInt(86_000_000))
  assert.equal(a.appliedDiscountPct, 86)                   // 정가 대비 실효
  assert.equal(a.isSpecial, true)
})

test('대체가 아니다 — 특별 할인만 적용하면 안 된다', () => {
  // 예전 판이 이랬다. 「기본 할인과 특별할인이 다 붙어야지」로 바로잡았고,
  // 되돌아가면 이 단정이 깨진다
  const a = computeLine({
    quantity: 1, unitPriceMinor: 100_000_000,
    discountPercent: 30, specialDiscountPercent: 80,
  })
  assert.notEqual(a.lineTotalMinor, BigInt(20_000_000), '특별 할인만 적용하면 안 된다')
})

test('특별 할인이 없으면 기본 할인만 — 0 과 «없음»은 다르다', () => {
  const none = computeLine({ quantity: 1, unitPriceMinor: 1000, discountPercent: 30 })
  assert.equal(none.lineTotalMinor, BigInt(700))
  assert.equal(none.isSpecial, false)
  assert.equal(none.baseLineTotalMinor, none.lineTotalMinor)

  // 0% 특별 할인은 «있는» 것이다 — 기본 할인 위에 0% 를 더 얹어 금액이 그대로다
  const zero = computeLine({
    quantity: 1, unitPriceMinor: 1000, discountPercent: 30, specialDiscountPercent: 0,
  })
  assert.equal(zero.isSpecial, true)
  assert.equal(zero.lineTotalMinor, BigInt(700))

  // null·빈 문자열은 «없음»이다
  for (const v of [null, undefined, '', '  ']) {
    assert.equal(computeLine({
      quantity: 1, unitPriceMinor: 1000, discountPercent: 30, specialDiscountPercent: v,
    }).isSpecial, false, `${JSON.stringify(v)} 는 «없음» 이어야 한다`)
  }
})

test('겹쳐도 금액이 음수가 되지 않는다', () => {
  const a = computeLine({
    quantity: 1, unitPriceMinor: 1000, discountPercent: 100, specialDiscountPercent: 100,
  })
  assert.equal(a.lineTotalMinor, BigInt(0))
  assert.equal(a.appliedDiscountPct, 100)
  // 범위 밖 값도 접힌다
  const over = computeLine({
    quantity: 1, unitPriceMinor: 1000, discountPercent: 150, specialDiscountPercent: 150,
  })
  assert.equal(over.lineTotalMinor, BigInt(0))
})

test('0원 줄에서 실효 할인율을 0으로 나누지 않는다', () => {
  const a = computeLine({
    quantity: 1, unitPriceMinor: 0, discountPercent: 30, specialDiscountPercent: 80,
  })
  assert.equal(a.appliedDiscountPct, 0)
  assert.ok(Number.isFinite(a.appliedDiscountPct))
})
