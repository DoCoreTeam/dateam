import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceQuote, usesNewPricing } from './quote-pricing.ts'
import { computeTotals, needsApproval } from '../domain/quote-math.ts'
import { buildSolutionQuote } from '../domain/pricebook/solution-engine.ts'
import { GCUBE_EDGE } from '../domain/pricebook/gcube-edge.ts'

test('★ 새 칸이 없으면 옛 길 — computeTotals 와 승인 판정이 그대로다', () => {
  const lines = [
    { quantity: 3, unitPriceMinor: 1_234_567n, discountPercent: 7.5, taxRate: 10, sectionIndex: 0 },
    { quantity: 1, unitPriceMinor: 300_000_000n, discountPercent: 20, taxRate: 10 },
  ]
  const r = priceQuote(lines, [{ name: '하드웨어' }], { unit: 10_000, mode: 'DOWN' }, 15, null)
  const t = computeTotals(lines, { unit: 10_000, mode: 'DOWN' })
  assert.equal(r.composed, false)
  assert.equal(r.lineTotals, null)
  assert.equal(r.totalMinor, t.totalMinor)
  assert.equal(r.discountMinor, t.discountMinor)
  assert.equal(r.approvalRequired, needsApproval(t, 15))
})

test('★ 제품으로 채운 gcube edge 예시를 저장하면 1회 84,000,000 + 부가세, 매년 11,100,000 은 따로', () => {
  const s = buildSolutionQuote(GCUBE_EDGE, GCUBE_EDGE.examples![0].conditions)
  const names = GCUBE_EDGE.sections.map((x) => x.name)
  const lines = s.lines.map((l) => ({
    quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, discountPercent: l.discountPercent, taxRate: l.taxRate,
    sectionIndex: names.indexOf(String(l.sectionKey)), listPriceMinor: l.listPriceMinor, priceSource: 'LIST',
    billing: l.billing, ratioPct: l.ratioPct, ratioOfSectionName: l.ratioOfSectionKey, kind: l.ratioPct ? 'RATIO' : 'QUANTITY',
  }))
  const r = priceQuote(lines, GCUBE_EDGE.sections, {}, 15, null)
  assert.equal(r.composed, true)
  assert.equal(r.subtotalMinor - r.discountMinor - r.sectionRoundingMinor, 84_000_000n)
  assert.equal(r.totalMinor, 92_400_000n)
  assert.equal(r.annualMinor, 11_100_000n)
  assert.equal(r.lineTotals![lines.findIndex((l) => l.ratioPct)], 11_100_000n, '비율 줄의 합계가 여기서 정해진다')
  assert.equal(r.approvalRequired, false)
})

test('★ 정상가가 있으면 단가를 깎은 만큼 승인에 걸린다', () => {
  const r = priceQuote([{ quantity: 1, unitPriceMinor: 6_000_000n, listPriceMinor: 7_300_000n, priceSource: 'LIST', taxRate: 10 }], [], {}, 15, null)
  assert.equal(r.approvalRequired, true, '17.8% 깎음')
})

test('묶음 절사 하나만 켜도 새 길이다', () => {
  assert.equal(usesNewPricing([{ quantity: 1, unitPriceMinor: 1n }], [{ name: 'a', roundingUnit: 10_000 }]), true)
  assert.equal(usesNewPricing([{ quantity: 1, unitPriceMinor: 1n }], [{ name: 'a', roundingUnit: 0 }]), false)
})

test('★ 옛 길: 할인 10% 라도 총액 절사로 깎은 몫이 크면 승인에 걸린다(REQ-022)', () => {
  const lines = [{ quantity: 1, unitPriceMinor: 47_000_000n, discountPercent: 10, taxRate: 10 }]
  const noRound = priceQuote(lines, [], {}, 15, null)
  assert.equal(noRound.approvalRequired, false, '절사가 없으면 10% 라 통과')
  // 계 46,530,000 → 천만원 단위 버림 40,000,000, 절사 6,530,000
  const r = priceQuote(lines, [], { unit: 10_000_000, mode: 'DOWN' }, 15, null)
  assert.equal(r.roundingMinor, 6_530_000n)
  assert.equal(r.approvalRequired, true)
})

test('★ 새 길(정상가 대비)도 총액 절사를 센다', () => {
  // 정상가 47,000,000 에서 40,000,000 으로 깎음 = 14.89%, 임계 15% 바로 아래
  const line = { quantity: 1, unitPriceMinor: 40_000_000n, listPriceMinor: 47_000_000n, priceSource: 'LIST', taxRate: 10 }
  assert.equal(priceQuote([line], [], {}, 15, null).approvalRequired, false)
  const r = priceQuote([line], [], { unit: 10_000_000, mode: 'DOWN' }, 15, null)
  assert.equal(r.composed, true)
  assert.ok(r.roundingMinor > 0n)
  assert.equal(r.approvalRequired, true)
})

test('올림 절사는 승인 판정을 바꾸지 않는다', () => {
  const lines = [{ quantity: 1, unitPriceMinor: 47_000_000n, discountPercent: 10, taxRate: 10 }]
  assert.equal(priceQuote(lines, [], { unit: 10_000_000, mode: 'UP' }, 15, null).approvalRequired, false)
})
