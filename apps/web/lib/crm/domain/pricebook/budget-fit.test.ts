import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitToBudget, type FitLine } from './budget-fit.ts'
import { discountVsList, needsApprovalVsList } from './list-approval.ts'
import { buildSolutionQuote } from './solution-engine.ts'
import { GCUBE_EDGE } from './gcube-edge.ts'
import { scaleLinesToTarget } from '../quote-target.ts'
import { needsApproval, computeTotals } from '../quote-math.ts'
import { composeQuote } from '../quote-compose.ts'

const M = (manwon: number) => BigInt(manwon) * BigInt(10_000)
const SECTIONS = GCUBE_EDGE.sections.map((s) => ({ key: s.name, roundingUnit: s.roundingUnit }))

function exampleLines(): FitLine[] {
  const r = buildSolutionQuote(GCUBE_EDGE, GCUBE_EDGE.examples![0].conditions)
  const byId = new Map(GCUBE_EDGE.items.map((i) => [i.id, i]))
  return r.lines.map((l) => ({ ...l, discountable: byId.get(l.itemId)?.discountable ?? false }))
}

test('★ 정답 4: 가격표 예시를 공급가 8,000만원에 맞추면 라이선스 할인 5.40%, 정확히 80,000,000원', () => {
  const r = fitToBudget(exampleLines(), SECTIONS, { totalMinor: M(8000), includesTax: false })
  assert.equal(r.reason, 'FITTED')
  assert.equal(r.discountPct, 5.4)
  assert.equal(r.achievedMinor, M(8000))
  assert.equal(r.gapMinor, BigInt(0))
  const q = composeQuote(r.lines, SECTIONS)
  assert.equal(q.sections.find((s) => s.key === '라이선스')!.totalMinor, M(7000))
  assert.equal(q.sections.find((s) => s.key === '구축비')!.totalMinor, M(1000), '구축비는 그대로')
  assert.equal(q.annual.supplyMinor, M(1050), '유지보수는 할인 뒤 라이선스 × 15%')
  const sd = q.sections.reduce((s, x) => s + x.roundingMinor, BigInt(0))
  assert.equal(needsApprovalVsList(r.lines.filter((l) => l.billing !== 'ANNUAL'), 15, sd), false, '5.4% 는 승인 기준 15% 아래')
})

test('단가는 그대로 둔다 — 정상가 7,300,000원이 다른 숫자가 되지 않는다', () => {
  const before = exampleLines()
  const r = fitToBudget(before, SECTIONS, { totalMinor: M(8000), includesTax: false })
  for (let i = 0; i < before.length; i++) assert.equal(String(r.lines[i].unitPriceMinor), String(before[i].unitPriceMinor))
})

test('예산이 이미 넘지 않으면 손대지 않는다', () => {
  const r = fitToBudget(exampleLines(), SECTIONS, { totalMinor: M(9000), includesTax: false })
  assert.equal(r.reason, 'ALREADY_UNDER')
  assert.equal(r.discountPct, null)
  assert.equal(r.gapMinor, M(600))
})

test('할인할 수 있는 줄만으로 모자라면 100% 를 넣지 않고 상한까지만 넣고 남은 차이를 적는다', () => {
  const r = fitToBudget(exampleLines(), SECTIONS, { totalMinor: M(500), includesTax: false })
  assert.equal(r.reason, 'NOT_ENOUGH')
  assert.equal(r.discountPct, 15)
  assert.ok(r.lines.every((l) => Number(l.discountPercent ?? 0) <= 15))
  assert.ok(r.gapMinor < BigInt(0))
})

test('★ 실측 2026-10-20: 정상가 4억 표를 2천만원에 맞추라 해도 96% 같은 할인을 넣지 않는다 — 승인 기준 15% 에서 멈추고 필요 할인율을 말한다', () => {
  const lines: FitLine[] = [
    { key: 'a', quantity: 1, unitPriceMinor: 280_000_000, taxRate: 10, discountable: true },
    { key: 'b', quantity: 1, unitPriceMinor: 120_000_000, taxRate: 10, discountable: true },
  ]
  const r = fitToBudget(lines, [], { totalMinor: M(2000), includesTax: false })
  assert.equal(r.reason, 'OVER_CAP')
  assert.equal(r.discountPct, 15)
  assert.equal(r.neededPct, 95)
  assert.ok(r.lines.every((l) => Number(l.discountPercent) === 15))
  assert.equal(r.achievedMinor, M(34000))
})

test('사람이 「그래도 넣기」를 누르면 필요한 할인율을 그대로 넣는다', () => {
  const lines: FitLine[] = [{ key: 'a', quantity: 1, unitPriceMinor: 400_000_000, taxRate: 10, discountable: true }]
  const r = fitToBudget(lines, [], { totalMinor: M(2000), includesTax: false }, {}, { allowOverCap: true })
  assert.equal(r.reason, 'FITTED')
  assert.equal(r.discountPct, 95)
  assert.equal(r.achievedMinor, M(2000))
})

test('상한은 바꿀 수 있다 — 30% 까지 허용하면 20% 필요한 표는 맞춘다', () => {
  const lines: FitLine[] = [{ key: 'a', quantity: 1, unitPriceMinor: 100_000_000, taxRate: 10, discountable: true }]
  const r = fitToBudget(lines, [], { totalMinor: M(8000), includesTax: false }, {}, { maxPct: 30 })
  assert.equal(r.reason, 'FITTED')
  assert.equal(r.discountPct, 20)
})

test('사람이 잠근 줄은 예산 맞추기가 덮지 않는다', () => {
  const lines = exampleLines().map((l) => (l.itemId === 'edge-std' ? { ...l, locked: true, discountPercent: 0 } : l))
  const r = fitToBudget(lines, SECTIONS, { totalMinor: M(8000), includesTax: false })
  assert.equal(Number(r.lines.find((l) => l.key === 'edge-std')!.discountPercent), 0)
})

test('★ 지금의 구멍: 단가를 깎는 맞추기는 33%를 깎아도 할인 칸 승인에 안 걸리지만, 정상가 대비로 재면 걸린다', () => {
  const lines = [{ quantity: 1, unitPriceMinor: 300_000_000, taxRate: 0 }]
  const scaled = scaleLinesToTarget(lines, { totalMinor: 200_000_000, includesTax: false }, {})
  assert.equal(needsApproval(computeTotals(scaled.lines)), false, '예전 판정은 구멍')
  const withList = scaled.lines.map((l) => ({ ...l, listPriceMinor: 300_000_000 }))
  assert.equal(needsApprovalVsList(withList), true)
  assert.ok(Math.abs(discountVsList(withList).ratePct - 33.33) < 0.01)
})

test('정상가가 없는 직접 입력 줄은 할인 칸으로 잰다', () => {
  const d = discountVsList([{ quantity: 1, unitPriceMinor: 1_000_000, discountPercent: 20 }])
  assert.equal(d.ratePct, 20)
})
