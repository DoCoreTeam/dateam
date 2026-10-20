import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitDraftToBudget } from './draft-budget.ts'
import { applyProductFill, type EngineLineJson } from './product-fill-apply.ts'
import { buildSolutionQuote } from '../../../../lib/crm/domain/pricebook/solution-engine.ts'
import { GCUBE_EDGE } from '../../../../lib/crm/domain/pricebook/gcube-edge.ts'
import { priceQuote } from '../../../../lib/crm/services/quote-pricing.ts'
import { jsonSafe } from '../../../../lib/crm/services/json-safe.ts'

const blank = {
  title: 't', currency: 'KRW', validUntil: '', notesMd: '', recipientPersonId: null, termIds: [], sections: [],
  roundingUnit: 0, roundingMode: 'DOWN', rateAxisKeys: [], lineNoteKeys: [], totalConvKeys: [], rateHoursPerMonth: '',
  lines: [{ name: '', descriptionMd: '', remark: '', kind: 'QUANTITY' as const, quantity: '1', unit: '', unitPriceMinor: '', discountPercent: '0', taxRate: '10' }],
}

function edgeDraft() {
  const r = buildSolutionQuote(GCUBE_EDGE, GCUBE_EDGE.examples![0].conditions)
  const j = jsonSafe({ lines: r.lines }) as { lines: EngineLineJson[] }
  return applyProductFill(blank, { productId: 'p', productName: 'gcube edge', sections: GCUBE_EDGE.sections, lines: j.lines, autoFilled: [], conditions: {} })
}

test('★ 화면에서 예산 8,000만원(공급가)에 맞추면 라이선스 할인 5.4%, 구축비 그대로, 저장 셈도 80,000,000', () => {
  const out = fitDraftToBudget(edgeDraft(), BigInt(80_000_000), false)
  assert.equal(out.changed, true)
  assert.match(out.message, /5\.4%/)
  const build = out.draft.lines.find((l) => l.name === 'STD 기본 구축')!
  assert.equal(Number(build.discountPercent), 0, '구축비는 할인 대상이 아니다')
  const std = out.draft.lines.find((l) => l.name === 'STD 기본 금액')!
  assert.equal(std.unitPriceMinor, '15000000', '단가는 그대로')
  assert.equal((std.provenance as { discount: { source: string } }).discount.source, 'BUDGET')
  const r = priceQuote(out.draft.lines.map((l) => ({ ...l })) as never, out.draft.sections.map((s) => ({ name: s.name, roundingUnit: s.roundingUnit ?? 0 })), {}, 15, null)
  assert.equal(r.subtotalMinor - r.discountMinor - r.sectionRoundingMinor, 80_000_000n)
  assert.equal(r.annualMinor, 10_500_000n)
  assert.equal(out.draft.budgetMinor, '80000000')
})

test('예산이 이미 넘지 않으면 값을 올리지 않고 남는 금액을 말한다', () => {
  const out = fitDraftToBudget(edgeDraft(), BigInt(90_000_000), false)
  assert.equal(out.changed, false)
  assert.match(out.message, /6,000,000원 남아요/)
})

test('손으로 친 줄만 있으면 그 줄들에 할인을 넣는다 — 예전처럼 단가를 깎지 않는다, 승인 기준을 넘으면 사람이 넣는다', () => {
  const d = { ...blank, lines: [{ ...blank.lines[0], name: '서버', unitPriceMinor: '300000000', taxRate: '0' }] }
  const auto = fitDraftToBudget(d, BigInt(200_000_000), false)
  assert.equal(auto.draft.lines[0].unitPriceMinor, '300000000')
  assert.equal(Number(auto.draft.lines[0].discountPercent), 15)
  assert.equal(auto.neededPct, 33.34)
  assert.match(auto.message, /33\.34% 가 필요해요/)
  const forced = fitDraftToBudget(d, BigInt(200_000_000), false, { allowOverCap: true })
  assert.ok(Number(forced.draft.lines[0].discountPercent) > 33)
  assert.equal(forced.neededPct, null)
})
