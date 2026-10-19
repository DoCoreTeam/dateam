import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyProductFill, type EngineLineJson } from './product-fill-apply.ts'
import { buildSolutionQuote } from '../../../../lib/crm/domain/pricebook/solution-engine.ts'
import { GCUBE_EDGE } from '../../../../lib/crm/domain/pricebook/gcube-edge.ts'
import { priceQuote } from '../../../../lib/crm/services/quote-pricing.ts'
import { jsonSafe } from '../../../../lib/crm/services/json-safe.ts'

function engineJson(): { lines: EngineLineJson[]; autoFilled: never[] } {
  const r = buildSolutionQuote(GCUBE_EDGE, GCUBE_EDGE.examples![0].conditions)
  return jsonSafe({ lines: r.lines, autoFilled: r.autoFilled }) as { lines: EngineLineJson[]; autoFilled: never[] }
}

const blank = {
  title: 't', currency: 'KRW', validUntil: '', notesMd: '', recipientPersonId: null, termIds: [], sections: [],
  roundingUnit: 0, roundingMode: 'DOWN', rateAxisKeys: [], lineNoteKeys: [], totalConvKeys: [], rateHoursPerMonth: '',
  lines: [{ name: '', descriptionMd: '', remark: '', kind: 'QUANTITY' as const, quantity: '1', unit: '', unitPriceMinor: '', discountPercent: '0', taxRate: '10' }],
}

test('★ 빈 견적에 넣으면 묶음 셋과 줄이 서고, 서버와 같은 셈으로 1회 84,000,000 매년 11,100,000', () => {
  const e = engineJson()
  const d = applyProductFill(blank, { productId: 'p', productName: 'gcube edge', sections: GCUBE_EDGE.sections, lines: e.lines, autoFilled: e.autoFilled, conditions: {} })
  assert.deepEqual(d.sections.map((s) => s.name), ['라이선스', '구축비', '유지보수'])
  // 저장 때 toLinePayload 가 싣는 칸 그대로 — 초안의 문자열을 서버 계산에 넘긴다
  const payload = d.lines.map((l) => ({ ...l, quantity: l.quantity || '1', unitPriceMinor: l.unitPriceMinor || '0', discountPercent: l.discountPercent || '0' }))
  const r = priceQuote(payload as never, d.sections.map((s) => ({ name: s.name, roundingUnit: s.roundingUnit ?? 0 })), {}, 15, null)
  assert.equal(r.subtotalMinor - r.discountMinor - r.sectionRoundingMinor, 84_000_000n)
  assert.equal(r.annualMinor, 11_100_000n)
  assert.equal(d.lines.find((l) => l.ratioPct)!.kind, 'RATIO')
  assert.equal(d.lines[0].priceSource, 'LIST')
})

test('이미 줄이 있으면 뒤에 묶음째 붙이고 사람이 만든 줄은 그대로 둔다', () => {
  const e = engineJson()
  const mine = { ...blank, sections: [{ name: '하드웨어' }], lines: [{ ...blank.lines[0], name: '서버', unitPriceMinor: '100', sectionIndex: 0 }] }
  const d = applyProductFill(mine, { productId: 'p', productName: 'x', sections: GCUBE_EDGE.sections, lines: e.lines, autoFilled: [], conditions: {} })
  assert.equal(d.sections[0].name, '하드웨어')
  assert.equal(d.lines[0].name, '서버')
  assert.equal(d.lines[1].sectionIndex, 1, '제품 묶음은 사람 묶음 뒤에 선다')
})
