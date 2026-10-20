import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GCUBE_EDGE } from '../pricebook/gcube-edge.ts'
import { composeFromText, type ComposeContext, type TextLine } from './compose-from-text.ts'
import { mergeTextLines, type CurrentLine } from './merge-text-lines.ts'
import { readText } from './read-rules.ts'
import { SOOKMYUNG_LINES, SOOKMYUNG_SENTENCE, TEST_CATALOG } from './fixtures.ts'

const CTX: ComposeContext = {
  products: [GCUBE_EDGE],
  items: [{ id: 'credit', name: 'gcube 크레딧', unit: '식', listPriceMinor: null, section: '크레딧 충전', taxRate: 10 }],
  laborGrades: [],
  gpuPrice: (model) => (model === 'RTX 5090' ? { model, hourlyKrw: 1_300, gpuCount: 1 } : null),
  companyKind: null,
}

const compose = (text: string, ctx: ComposeContext = CTX) => composeFromText(readText(text, TEST_CATALOG), ctx)
const line = (lines: readonly TextLine[], name: RegExp) => {
  const l = lines.find((x) => name.test(x.name))
  assert.ok(l, `줄 없음 ${name}`)
  return l
}

test('숙명여대 여섯 줄이 묶음 셋으로 선다', () => {
  const q = compose(SOOKMYUNG_LINES)
  assert.equal(line(q.lines, /크레딧/).unitPriceMinor, BigInt(280_000_000))
  assert.equal(line(q.lines, /크레딧/).section, '크레딧 충전')
  assert.equal(line(q.lines, /^STD 기본 금액/).unitPriceMinor, BigInt(15_000_000))
  assert.equal(line(q.lines, /데이터센터/).quantity, 4)
  assert.equal(line(q.lines, /워크스테이션/).quantity, 6)
  assert.equal(line(q.lines, /추가 노드/).quantity, 10)
  assert.equal(line(q.lines, /STD 기본 구축/).unitPriceMinor, BigInt(10_000_000))
  const si = line(q.lines, /SSO/)
  assert.equal(si.section, 'SI')
  assert.equal(si.quantity, 2)
  assert.equal(si.unitPriceMinor, BigInt(7_800_000))
  // 교육기관 할인은 라이선스에만, 구축비에는 안 걸린다
  assert.equal(line(q.lines, /^STD 기본 금액/).discountPercent, 10)
  assert.equal(line(q.lines, /STD 기본 구축/).discountPercent, 0)
  assert.deepEqual(q.sections.map((s) => s.name).slice(0, 2), ['크레딧 충전', '라이선스'])
  assert.ok(q.sections.some((s) => s.name === 'SI'))
  assert.ok(q.autoFixed.some((f) => /노드 30대/.test(f.provenance.note ?? '') && /기본 포함 20대/.test(f.provenance.note ?? '')))
  assert.ok(q.autoFixed.some((f) => /설치/.test(f.provenance.note ?? '') && /기본 구축/.test(f.provenance.note ?? '')))
  assert.ok(!q.lines.some((l) => /설치/.test(l.name)))
})

test('한 문장으로 써도 같은 묶음이 선다', () => {
  const q = compose(SOOKMYUNG_SENTENCE)
  assert.equal(line(q.lines, /크레딧/).unitPriceMinor, BigInt(280_000_000))
  assert.equal(line(q.lines, /데이터센터/).quantity, 4)
  assert.equal(line(q.lines, /SI|SSO|정산/).unitPriceMinor, BigInt(7_800_000))
})

test('GPU 이용은 GPU 가격표 판매가로, 없으면 가격표에 없음', () => {
  const q = compose('RTX 5090 17대 2개월\nH200 2대 1개월')
  const a = line(q.lines, /RTX 5090/)
  assert.equal(a.unitPriceMinor, BigInt(1_300 * 720))
  assert.equal(a.quantity, 17)
  assert.equal(a.durationValue, 2)
  assert.equal(a.provenance.unitPrice.source, 'GPU_PRICE')
  const b = line(q.lines, /H200/)
  assert.equal(b.unitPriceMinor, null)
  assert.equal(b.provenance.unitPrice.note, '가격표에 없음')
})

test('조립 파일은 금액을 세지 않는다 — 곱셈은 엔진 몫', () => {
  const src = readFileSync(new URL('./compose-from-text.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /unitPriceMinor\s*\*|\*\s*BigInt\(.*quantity/)
})

function asCurrent(lines: readonly TextLine[], patch: (l: CurrentLine) => CurrentLine = (l) => l): CurrentLine[] {
  return lines.map((l) => patch({
    textKey: l.textKey, lockedFields: [], name: l.name, quantity: String(l.quantity), unit: l.unit,
    unitPriceMinor: l.unitPriceMinor === null ? '' : String(l.unitPriceMinor), discountPercent: String(l.discountPercent),
  }))
}

test('같은 글을 두 번 정리하면 표 변화 0', () => {
  const q = compose(SOOKMYUNG_LINES)
  const again = compose(SOOKMYUNG_LINES)
  const r = mergeTextLines(asCurrent(q.lines), again.lines)
  assert.deepEqual(r.ops, [])
  assert.deepEqual(r.differs, [])
})

test('사람이 고친 칸은 다시 정리해도 남고 조건과 다름을 말한다', () => {
  const q = compose(SOOKMYUNG_LINES)
  const cur = asCurrent(q.lines, (l) => (/데이터센터/.test(l.name) ? { ...l, quantity: '4', lockedFields: ['quantity'] } : l))
  const changed = compose(SOOKMYUNG_LINES.replace('H100 4장', 'H100 6장'))
  const r = mergeTextLines(cur, changed.lines)
  const dc = cur.find((l) => /데이터센터/.test(l.name))!
  assert.ok(!r.ops.some((o) => o.op === 'update' && o.textKey === dc.textKey && o.fields.includes('quantity')))
  assert.deepEqual(r.differs.find((d) => d.textKey === dc.textKey)?.items, [{ field: 'quantity', locked: '4', fromText: '6' }])
})

test('글 줄을 지우면 그 줄에서 나온 항목만 지운다, 표에 직접 쓴 줄은 안 건드린다', () => {
  const q = compose(SOOKMYUNG_LINES)
  const cur = [...asCurrent(q.lines), { textKey: null, lockedFields: [], name: '사람이 쓴 줄', quantity: '1', unit: '식', unitPriceMinor: '100', discountPercent: '0' }]
  const fewer = compose(SOOKMYUNG_LINES.replace('크레딧 2.8억\n', ''))
  const r = mergeTextLines(cur, fewer.lines)
  const removed = r.ops.filter((o) => o.op === 'remove')
  assert.equal(removed.length, 1)
  assert.match((removed[0] as { textKey: string }).textKey, /^item:credit/)
})

test('「기존 STD 고객」을 쓰고 ENT 를 고르면 전환 구축이 들어간다 — 글에서 읽음', () => {
  const r = readText('숙명여대 기존 STD 고객\nEDGE ENT, H100 8장', TEST_CATALOG)
  assert.equal(r[0].priorEdition, 'STD')
  assert.equal(r[0].edition, null, '이미 쓰는 에디션을 지금 고르는 에디션으로 읽으면 안 된다')
  const q = composeFromText(r, CTX)
  assert.ok(q.lines.some((l) => l.itemId === 'edge-ent-switch'))
  assert.ok(q.autoFilled.some((a) => /글: 「기존 STD 고객」/.test(a.provenance.note ?? '')))
})

test('지난 계약에서 STD 를 샀으면 글에 안 써도 들어가고 근거가 계약이다', () => {
  const ctx = { ...CTX, owned: { itemIds: ['edge-std'], evidence: { 'edge-std': '2025-03-14 체결 gcube 도입' } } }
  const q = composeFromText(readText('EDGE ENT, H100 8장', TEST_CATALOG), ctx)
  assert.ok(q.lines.some((l) => l.itemId === 'edge-ent-switch'))
  assert.ok(q.autoFilled.some((a) => /2025-03-14 체결 gcube 도입/.test(a.provenance.note ?? '')))
  const none = composeFromText(readText('EDGE ENT, H100 8장', TEST_CATALOG), CTX)
  assert.ok(!none.lines.some((l) => l.itemId === 'edge-ent-switch'))
})
