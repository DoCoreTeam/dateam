import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GCUBE_EDGE } from '../pricebook/gcube-edge.ts'
import { autofix, undoFix, type FixLine } from './autofix.ts'

let seq = 0
function L(over: Partial<FixLine>): FixLine {
  seq += 1
  return {
    key: `k${seq}`, itemId: null, name: '품목', kind: 'QUANTITY', section: null, quantity: '1', unit: '식',
    unitPriceMinor: '1000', listPriceMinor: null, durationValue: '', durationUnit: '', ratioPct: null,
    ratioOfSectionName: null, remark: '', lockedFields: [], ...over,
  }
}

const item = (id: string) => GCUBE_EDGE.items.find((i) => i.id === id)!
const E = (id: string, over: Partial<FixLine> = {}) => L({
  itemId: id, name: item(id).name, section: item(id).section,
  unitPriceMinor: String(item(id).listPriceMinor ?? 0), listPriceMinor: item(id).listPriceMinor === null ? null : String(item(id).listPriceMinor), ...over,
})

test('1,440 Hours 는 수량이 아니라 기간으로 옮긴다', () => {
  const r = autofix([L({ name: 'A100 이용', quantity: '1440', unit: 'Hours', unitPriceMinor: '3000' })])
  assert.equal(r.fixes[0].code, 'PERIOD_IN_QTY')
  assert.deepEqual([r.lines[0].quantity, r.lines[0].durationValue, r.lines[0].durationUnit, r.lines[0].kind], ['1', '1440', 'HOUR', 'PERIOD'])
})

test('정상가의 100배 단가는 통화 자리수 실수로 고친다', () => {
  const r = autofix([L({ unitPriceMinor: '730000000', listPriceMinor: '7300000' })])
  assert.equal(r.fixes[0].code, 'HUNDRED_X')
  assert.equal(r.lines[0].unitPriceMinor, '7300000')
})

test('정상가와 10배 넘게 다르면 정상가로', () => {
  const r = autofix([L({ unitPriceMinor: '200000', listPriceMinor: '7300000' })])
  assert.equal(r.fixes[0].code, 'TEN_X_OFF')
  assert.equal(r.lines[0].unitPriceMinor, '7300000')
})

test('같은 품목 두 줄은 한 줄로 합친다', () => {
  const r = autofix([E('edge-gpu-dc', { quantity: '2' }), E('edge-node', { quantity: '3' }), E('edge-gpu-dc', { quantity: '2' })])
  assert.equal(r.fixes[0].code, 'DUPLICATE')
  assert.equal(r.lines.length, 2)
  assert.equal(r.lines[0].quantity, '4')
})

test('ENT 인데 옵션을 따로 받으면 0원으로', () => {
  const r = autofix([E('edge-ent'), E('edge-opt-portal')], [GCUBE_EDGE])
  const f = r.fixes.find((x) => x.code === 'INCLUDED_PAID')
  assert.ok(f)
  assert.equal(r.lines[1].unitPriceMinor, '0')
})

test('STD 인데 GPU 300장을 넘으면 ENT 로, 구축도 따라 바꾼다', () => {
  const r = autofix([E('edge-std'), E('edge-gpu-dc', { quantity: '320' }), E('edge-build-std')], [GCUBE_EDGE])
  assert.deepEqual(r.fixes.filter((x) => x.code === 'CAP_EXCEEDED').length, 2)
  assert.equal(r.lines[0].itemId, 'edge-ent')
  assert.equal(r.lines[2].itemId, 'edge-build-ent')
})

test('비율 대상 묶음이 사라지면 그 줄을 뺀다', () => {
  const r = autofix([E('edge-build-std'), E('edge-maint-std', { ratioPct: '15', ratioOfSectionName: '라이선스', unitPriceMinor: '0' })])
  assert.equal(r.fixes[0].code, 'RATIO_ORPHAN')
  assert.equal(r.lines.length, 1)
})

test('되돌리기 한 번이면 원래 줄과 같다 — 일곱 가지 전부', () => {
  const cases: [FixLine[], typeof GCUBE_EDGE[]][] = [
    [[L({ quantity: '1440', unit: 'Hours' })], []],
    [[L({ unitPriceMinor: '730000000', listPriceMinor: '7300000' })], []],
    [[L({ unitPriceMinor: '200000', listPriceMinor: '7300000' })], []],
    [[E('edge-gpu-dc', { quantity: '2' }), E('edge-gpu-dc', { quantity: '2' })], []],
    [[E('edge-ent'), E('edge-opt-portal')], [GCUBE_EDGE]],
    [[E('edge-std'), E('edge-gpu-dc', { quantity: '320' })], [GCUBE_EDGE]],
    [[E('edge-build-std'), E('edge-maint-std', { ratioPct: '15', ratioOfSectionName: '라이선스' })], []],
  ]
  for (const [lines, products] of cases) {
    const r = autofix(lines, products)
    assert.equal(r.fixes.length, 1, lines.map((l) => l.name).join())
    assert.deepEqual(undoFix(r.lines, r.fixes[0]), lines)
  }
})

test('사람이 고친 칸은 고치지 않는다', () => {
  const r = autofix([
    L({ unitPriceMinor: '730000000', listPriceMinor: '7300000', lockedFields: ['unitPrice'] }),
    L({ quantity: '1440', unit: 'Hours', lockedFields: ['quantity'] }),
  ])
  assert.deepEqual(r.fixes, [])
})
