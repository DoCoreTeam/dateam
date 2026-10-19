import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeQuote, totalCostOverYears, ComposeError, type ComposeLine } from './quote-compose.ts'
import { computeTotals } from './quote-math.ts'

test('★ 새 칸이 없으면 computeTotals 와 같은 숫자다 — 지난 견적은 한 원도 안 바뀐다', () => {
  const lines: ComposeLine[] = [
    { key: 'a', quantity: 3, unitPriceMinor: 1_234_567, discountPercent: 7.5, taxRate: 10 },
    { key: 'b', quantity: 1.5, unitPriceMinor: 999_999, discountPercent: 0, specialDiscountPercent: 12, taxRate: 10 },
    { key: 'c', quantity: 17, unitPriceMinor: 936_000, durationValue: 2, durationUnit: 'MONTH', priceBasis: 'MONTH', taxRate: 0 },
  ]
  const rounding = { unit: 10_000, mode: 'DOWN' }
  const old = computeTotals(lines, rounding)
  const now = composeQuote(lines, [], rounding).once
  assert.equal(now.subtotalMinor, old.subtotalMinor)
  assert.equal(now.discountMinor, old.discountMinor)
  assert.equal(now.taxMinor, old.taxMinor)
  assert.equal(now.totalMinor, old.totalMinor)
  assert.equal(now.roundingMinor, old.roundingMinor)
  assert.equal(now.sectionRoundingMinor, BigInt(0))
})

test('묶음 절사는 할인 뒤 소계에 만원 미만을 버린다', () => {
  const r = composeQuote(
    [{ key: 'a', sectionKey: 'L', quantity: 1, unitPriceMinor: 74_000_000, discountPercent: 5.4, taxRate: 10 }],
    [{ key: 'L', roundingUnit: 10_000 }],
  )
  const s = r.sections[0]
  assert.equal(s.subtotalMinor, BigInt(70_004_000))
  assert.equal(s.roundingMinor, BigInt(4_000))
  assert.equal(s.totalMinor, BigInt(70_000_000))
  assert.equal(r.once.taxMinor, BigInt(7_000_000), '세금도 절사 뒤 금액에 선다')
})

test('비율 항목은 대상 묶음의 절사 뒤 금액에 걸리고, 매년이면 1회 합계에 안 섞인다', () => {
  const r = composeQuote(
    [
      { key: 'lic', sectionKey: 'L', quantity: 1, unitPriceMinor: 66_600_000, taxRate: 10 },
      { key: 'm', sectionKey: 'M', billing: 'ANNUAL', quantity: 1, unitPriceMinor: 0, ratioPct: 15, ratioOfSectionKey: 'L', taxRate: 10 },
    ],
    [{ key: 'L', roundingUnit: 10_000 }, { key: 'M', roundingUnit: 10_000 }],
  )
  assert.equal(r.lines.find((l) => l.key === 'm')!.ratioBaseMinor, BigInt(66_600_000))
  assert.equal(r.annual.supplyMinor, BigInt(9_990_000))
  assert.equal(r.once.subtotalMinor, BigInt(66_600_000))
})

test('비율 항목은 줄 하나를 대상으로 잡을 수도 있다', () => {
  const r = composeQuote([
    { key: 'a', quantity: 2, unitPriceMinor: 1_000_000 },
    { key: 'r', quantity: 1, unitPriceMinor: 0, ratioPct: 10, ratioOfLineKey: 'a' },
  ])
  assert.equal(r.lines.find((l) => l.key === 'r')!.amounts.lineTotalMinor, BigInt(200_000))
  assert.equal(r.once.subtotalMinor, BigInt(2_200_000))
})

test('비율이 서로를 가리키면 셀 수 없다고 말한다', () => {
  assert.throws(
    () => composeQuote([
      { key: 'a', quantity: 1, unitPriceMinor: 0, ratioPct: 10, ratioOfLineKey: 'b' },
      { key: 'b', quantity: 1, unitPriceMinor: 0, ratioPct: 10, ratioOfLineKey: 'a' },
    ]),
    (e: unknown) => e instanceof ComposeError && e.code === 'RATIO_CYCLE',
  )
})

test('대상이 없는 비율 항목은 던진다 — 조용히 0원으로 두지 않는다', () => {
  assert.throws(
    () => composeQuote([{ key: 'r', quantity: 1, unitPriceMinor: 0, ratioPct: 10, ratioOfSectionKey: 'X' }]),
    (e: unknown) => e instanceof ComposeError && e.code === 'RATIO_TARGET_MISSING',
  )
})

test('5년 총비용은 초기 + 매년 × (5 − 무상 1년)', () => {
  assert.equal(totalCostOverYears(BigInt(84_000_000), BigInt(11_100_000), 5, 1), BigInt(128_400_000))
})
