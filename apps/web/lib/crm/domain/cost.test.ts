// 원가 계산 SSOT — 마진이 틀리면 «남는 장사»를 잘못 판단한다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCostAmount, computeCostTotals, computeMargin, computeLineMargin, type CostRow,
} from './cost.ts'
import { costGroupOf } from '../../terms/cost.ts'

const A = (over: Partial<CostRow> = {}): CostRow => ({
  category: 'MATERIAL', stage: 'ESTIMATE', inputMode: 'AMOUNT', amountMinor: BigInt(0), ...over,
})

test('금액으로 넣으면 그대로', () => {
  assert.equal(computeCostAmount(A({ amountMinor: BigInt(1000) })), BigInt(1000))
  assert.equal(computeCostAmount(A({ amountMinor: '1000' })), BigInt(1000))
})

test('공수로 넣으면 M/M × 등급 단가 — 사람은 곱셈을 하지 않는다', () => {
  const v = computeCostAmount(A({
    category: 'LABOR', inputMode: 'EFFORT', effortMm: 1.0, gradeCostPerMmMinor: BigInt(8000000),
  }))
  assert.equal(v, BigInt(8000000))
})

test('공수는 소수 둘까지 — 0.5 M/M 이 반올림으로 사라지지 않는다', () => {
  assert.equal(computeCostAmount(A({ inputMode: 'EFFORT', effortMm: 0.5, gradeCostPerMmMinor: BigInt(8000000) })), BigInt(4000000))
  assert.equal(computeCostAmount(A({ inputMode: 'EFFORT', effortMm: 1.25, gradeCostPerMmMinor: BigInt(8000000) })), BigInt(10000000))
  assert.equal(computeCostAmount(A({ inputMode: 'EFFORT', effortMm: '0.33', gradeCostPerMmMinor: BigInt(9000000) })), BigInt(2970000))
})

test('등급이 없으면 0 — 지어내지 않는다', () => {
  assert.equal(computeCostAmount(A({ inputMode: 'EFFORT', effortMm: 2, gradeCostPerMmMinor: null })), BigInt(0))
})

test('비율은 기준 없이 계산하지 않는다 — 항목 하나만 보고는 알 수 없다', () => {
  assert.equal(computeCostAmount(A({ inputMode: 'RATIO', ratioPct: 10, ratioBase: 'REVENUE' })), BigInt(0))
})

test('비율은 매출 또는 원가 기준으로 갈린다', () => {
  const base = { revenueMinor: BigInt(100000000), costMinor: BigInt(60000000) }
  assert.equal(computeCostAmount(A({ inputMode: 'RATIO', ratioPct: 10, ratioBase: 'REVENUE' }), base), BigInt(10000000))
  assert.equal(computeCostAmount(A({ inputMode: 'RATIO', ratioPct: 10, ratioBase: 'COST' }), base), BigInt(6000000))
})

test('비율 항목은 다른 항목이 다 정해진 뒤에 계산된다 — 두 번에 걸쳐 푼다', () => {
  const rows: CostRow[] = [
    A({ category: 'MATERIAL', amountMinor: BigInt(50000000) }),
    A({ category: 'LABOR', inputMode: 'EFFORT', effortMm: 2, gradeCostPerMmMinor: BigInt(8000000) }),
    // 원가의 10% — 위 둘(5천만 + 1천6백만)의 10%
    A({ category: 'OVERHEAD', inputMode: 'RATIO', ratioPct: 10, ratioBase: 'COST' }),
  ]
  const t = computeCostTotals(rows, BigInt(100000000))
  assert.equal(t.amounts[0], BigInt(50000000))
  assert.equal(t.amounts[1], BigInt(16000000))
  assert.equal(t.amounts[2], BigInt(6600000))
  assert.equal(t.totalMinor, BigInt(72600000))
})

test('비율이 비율을 참조하지 않는다 — 순환이 생기면 아무도 못 푼다', () => {
  const rows: CostRow[] = [
    A({ category: 'MATERIAL', amountMinor: BigInt(1000000) }),
    A({ category: 'OVERHEAD', inputMode: 'RATIO', ratioPct: 10, ratioBase: 'COST' }),
    A({ category: 'CONTINGENCY', inputMode: 'RATIO', ratioPct: 10, ratioBase: 'COST' }),
  ]
  const t = computeCostTotals(rows, BigInt(0))
  // 둘 다 «비율 아닌 것의 합(100만)»의 10% — 서로를 더하지 않는다
  assert.equal(t.amounts[1], BigInt(100000))
  assert.equal(t.amounts[2], BigInt(100000))
})

test('갈래·대분류·시점으로 각각 합계가 나온다', () => {
  const rows: CostRow[] = [
    A({ category: 'MATERIAL', amountMinor: BigInt(100) }),
    A({ category: 'LABOR', amountMinor: BigInt(200) }),
    A({ category: 'PARTNER_FEE', amountMinor: BigInt(300) }),
    A({ category: 'WARRANTY', amountMinor: BigInt(400), stage: 'ACTUAL' }),
  ]
  const t = computeCostTotals(rows, BigInt(0))
  assert.equal(t.byCategory.MATERIAL, BigInt(100))
  assert.equal(t.byGroup.DIRECT, BigInt(300))       // 재료비 + 노무비
  assert.equal(t.byGroup.SUBCONTRACT, BigInt(300))  // 파트너 수수료
  assert.equal(t.byGroup.RISK, BigInt(400))
  assert.equal(t.byStage.ESTIMATE, BigInt(600))
  assert.equal(t.byStage.ACTUAL, BigInt(400))
  assert.equal(t.totalMinor, BigInt(1000))
})

test('대분류는 갈래에서 파생한다 — 표에 두면 둘이 어긋난다', () => {
  assert.equal(costGroupOf('MATERIAL'), 'DIRECT')
  assert.equal(costGroupOf('PARTNER_FEE'), 'SUBCONTRACT')
  assert.equal(costGroupOf('OVERHEAD'), 'INDIRECT')
  assert.equal(costGroupOf('WARRANTY'), 'RISK')
})

test('마진은 매출 − 원가', () => {
  const m = computeMargin(BigInt(100000000), BigInt(60000000))
  assert.equal(m.grossProfitMinor, BigInt(40000000))
  assert.equal(m.marginPct, 40)
})

test('원가가 매출을 넘으면 마진이 음수 — 막지 않고 보여 준다', () => {
  const m = computeMargin(BigInt(100), BigInt(150))
  assert.equal(m.grossProfitMinor, BigInt(-50))
  assert.equal(m.marginPct, -50)
})

test('매출이 0이면 마진율은 null — 0으로 나누느니 «모른다»고 말한다', () => {
  assert.equal(computeMargin(BigInt(0), BigInt(1000)).marginPct, null)
})

test('라인 마진은 그 라인에 붙은 원가만 본다', () => {
  const m = computeLineMargin(BigInt(10000000), [
    A({ category: 'MATERIAL', amountMinor: BigInt(6000000) }),
  ])
  assert.equal(m.costMinor, BigInt(6000000))
  assert.equal(m.marginPct, 40)
})

test('원가가 하나도 없으면 마진은 매출 전부 — 「모른다」가 아니라 「아직 안 적었다」', () => {
  const m = computeLineMargin(BigInt(1000), [])
  assert.equal(m.costMinor, BigInt(0))
  assert.equal(m.marginPct, 100)
})
