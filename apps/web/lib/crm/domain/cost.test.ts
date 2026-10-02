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

/* ── 통화가 섞인 묶음 (v0.10.85x) ─────────────────── */

/*
  **실측 2026-10-02.** 공급사 USD 견적서가 원가로 들어와 $1,080.00 의 센트값 108000 이
  원화와 그대로 더해졌다. 합계는 숫자가 나왔고 아무도 못 알아봤다 —
  그 딜의 마진율이 94.6% 로 떠 있었고 참값은 27.3% 였다.
  **단위가 다른 것을 더하면 틀린 줄도 모른다.**
*/

const USD_RATE = 1346.4

test('★ 통화가 섞이면 환산해서 센다 — USD 센트와 원을 그대로 더하지 않는다', () => {
  const rows: CostRow[] = [
    // $1,080.00 · 1,346.40 고시 → 1,454,112원
    A({ category: 'MATERIAL', amountMinor: BigInt(108000), currency: 'USD', fxRate: USD_RATE, fxDate: '2026-09-14' }),
    A({ category: 'EXPENSE', amountMinor: BigInt(100000) }),
  ]
  const t = computeCostTotals(rows, BigInt(2000000), 'KRW')

  assert.equal(t.currency, 'KRW')
  assert.equal(t.amounts[0], BigInt(108000), '항목 금액은 그 항목의 통화 그대로여야 한다')
  assert.equal(t.baseAmounts[0], BigInt(1454112), '환산액이 틀렸다')
  assert.equal(t.totalMinor, BigInt(1554112), '208,000원이 나오면 센트를 원으로 더한 것이다')
  assert.equal(t.skipped.length, 0)
})

test('★ 환율이 없는 줄은 0 으로 들어가지 않고 빠진 사실이 남는다', () => {
  const rows: CostRow[] = [
    A({ id: 'c_usd', category: 'MATERIAL', amountMinor: BigInt(108000), currency: 'USD', fxRate: null }),
    A({ category: 'EXPENSE', amountMinor: BigInt(100000) }),
  ]
  const t = computeCostTotals(rows, BigInt(2000000), 'KRW')

  assert.equal(t.skipped.length, 1, '빠진 것을 말하지 않으면 합계가 조용히 작아진다')
  assert.equal(t.skipped[0].id, 'c_usd')
  assert.equal(t.skipped[0].currency, 'USD')
  assert.equal(t.skipped[0].amountMinor, BigInt(108000))
  assert.equal(t.baseAmounts[0], null, '못 센 것을 0 으로 적으면 0원짜리 원가로 보인다')
  assert.equal(t.totalMinor, BigInt(100000), '못 센 금액이 합계에 섞였다')
  assert.equal(t.byCategory.MATERIAL, undefined, '못 센 것이 갈래 합계에 들어갔다')
})

test('★ 환율 0 과 음수는 환율이 아니다 — 0 으로 곱하면 원가가 사라진다', () => {
  for (const bad of [0, -1346.4]) {
    const t = computeCostTotals(
      [A({ amountMinor: BigInt(108000), currency: 'USD', fxRate: bad })],
      BigInt(2000000), 'KRW',
    )
    assert.equal(t.totalMinor, BigInt(0), `환율 ${bad} 로 환산했다`)
    assert.equal(t.skipped.length, 1, `환율 ${bad} 를 환율로 받았다`)
  }
})

test('★ 행마다 자기 환율을 쓴다 — 9월 고시와 10월 고시가 한 표에 섞여도', () => {
  const rows: CostRow[] = [
    A({ id: 'a', amountMinor: BigInt(100000), currency: 'USD', fxRate: 1300, fxDate: '2026-09-14' }),
    A({ id: 'b', amountMinor: BigInt(100000), currency: 'USD', fxRate: 1400, fxDate: '2026-10-01' }),
  ]
  const t = computeCostTotals(rows, BigInt(0), 'KRW')
  assert.equal(t.baseAmounts[0], BigInt(1300000))
  assert.equal(t.baseAmounts[1], BigInt(1400000), '먼저 찾은 환율을 둘 다에 쓰면 조용히 틀린다')
})

test('통화를 안 적은 옛 행은 기준 통화로 본다 — 환산할 것이 없다', () => {
  const t = computeCostTotals([A({ amountMinor: BigInt(100000) })], BigInt(0), 'KRW')
  assert.equal(t.totalMinor, BigInt(100000))
  assert.equal(t.baseAmounts[0], BigInt(100000))
  assert.equal(t.skipped.length, 0)
})

test('기준 통화와 같은 통화는 환율 없이도 센다 — 환산할 것이 없으니 못 셀 이유도 없다', () => {
  const t = computeCostTotals(
    [A({ amountMinor: BigInt(108000), currency: 'usd', fxRate: null })],
    BigInt(0), 'USD',
  )
  assert.equal(t.totalMinor, BigInt(108000))
  assert.equal(t.skipped.length, 0)
})

test('★ 비율 항목은 환산한 원가 위에서 계산된다 — 센트 위에서 세면 7% 가 13배 작아진다', () => {
  const rows: CostRow[] = [
    A({ category: 'MATERIAL', amountMinor: BigInt(108000), currency: 'USD', fxRate: USD_RATE }),
    A({ category: 'OVERHEAD', inputMode: 'RATIO', ratioPct: 10, ratioBase: 'COST' }),
  ]
  const t = computeCostTotals(rows, BigInt(0), 'KRW')
  // 1,454,112원의 10%
  assert.equal(t.amounts[1], BigInt(145411))
  assert.equal(t.baseAmounts[1], BigInt(145411), '비율 항목은 이미 기준 통화다')
  assert.equal(t.totalMinor, BigInt(1599523))
})

test('기본 기준 통화는 원이다 — 안 넘긴 호출부가 조용히 달라지지 않게', () => {
  const t = computeCostTotals([A({ amountMinor: BigInt(100000) })], BigInt(0))
  assert.equal(t.currency, 'KRW')
})
