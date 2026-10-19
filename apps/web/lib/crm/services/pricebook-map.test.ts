import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toEngineProduct, itemToData, ruleToRow, examplesToJson, examplesOf, ruleFromRow, type ItemDbRow } from './pricebook-map.ts'
import { GCUBE_EDGE } from '../domain/pricebook/gcube-edge.ts'
import { buildSolutionQuote } from '../domain/pricebook/solution-engine.ts'

function roundTrip() {
  const items: ItemDbRow[] = GCUBE_EDGE.items.map((it, i) => {
    const d = itemToData(it, i)
    return {
      id: it.id, name: String(d.name), unitPriceMinor: d.unitPriceMinor as bigint, unit: d.unit as string | null,
      taxRate: String(d.taxRate), section: d.section as string, basis: String(d.basis), billing: String(d.billing),
      ratioPct: d.ratioPct === null ? null : String(d.ratioPct), ratioOfSection: d.ratioOfSection as string | null,
      discountable: Boolean(d.discountable), remark: d.remark as string | null, needsReview: false, isActive: true, position: i,
    }
  })
  const rules = GCUBE_EDGE.rules.map((r, i) => ({ ...ruleToRow(r, i), isEnabled: true }))
  const product = {
    id: GCUBE_EDGE.id, name: GCUBE_EDGE.name, businessTypeKey: 'SOLUTION',
    sections: GCUBE_EDGE.sections, tcoYears: 5, freeYears: 1,
    examples: JSON.parse(JSON.stringify(examplesToJson(GCUBE_EDGE.examples!))),
  }
  return toEngineProduct(product, items, rules)
}

test('★ gcube edge 가 DB 줄로 갔다 와도 품목 규칙 예시가 그대로다', () => {
  const back = roundTrip()
  assert.deepEqual(back.items, GCUBE_EDGE.items.map((i) => ({ ...i, remark: i.remark ?? null, ratioPct: i.ratioPct ?? null, ratioOfSection: i.ratioOfSection ?? null, needsReview: false })))
  assert.deepEqual(back.rules, GCUBE_EDGE.rules)
  assert.equal(back.examples![0].expectTcoMinor, GCUBE_EDGE.examples![0].expectTcoMinor)
})

test('★ 왕복한 제품으로 계산해도 정답 1 이 나온다', () => {
  const r = buildSolutionQuote(roundTrip(), GCUBE_EDGE.examples![0].conditions)
  assert.equal(r.tcoMinor, BigInt(128_400_000))
})

test('꺼 둔 규칙과 판매 중지 품목은 엔진에 안 간다', () => {
  const p = toEngineProduct(
    { id: 'p', name: 'x', businessTypeKey: 'SOLUTION', sections: [], tcoYears: 5, freeYears: 1, examples: [] },
    [{ id: 'a', name: 'A', unitPriceMinor: '100', unit: '식', taxRate: '10', section: null, basis: 'FIXED', billing: 'ONCE', ratioPct: null, ratioOfSection: null, discountable: true, remark: null, needsReview: false, isActive: false }],
    [{ kind: 'CAP', body: { item: 'a', varKey: 'nodes', max: 1 }, isEnabled: false }],
  )
  assert.equal(p.items.length, 0)
  assert.equal(p.rules.length, 0)
})

test('모르는 규칙 종류는 null — 조용히 다른 규칙으로 읽지 않는다', () => {
  assert.equal(ruleFromRow({ kind: 'FORMULA', body: {}, isEnabled: true }), null)
})

test('깨진 예시 JSON 은 버린다', () => {
  assert.deepEqual(examplesOf([{ label: 'x' }, null, { conditions: {}, expectOnceMinor: 'abc' }]), [])
})
