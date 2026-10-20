import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CrmError } from '../domain/errors.ts'
import { GCUBE_EDGE } from '../domain/pricebook/gcube-edge.ts'
import { TEST_CATALOG, SOOKMYUNG_LINES } from '../domain/quote-text/fixtures.ts'
import { fillCore, parseTextFillInput, type CallAi, type Loaded } from './quote-text-fill.ts'

const LOADED: Loaded = {
  catalog: { ...TEST_CATALOG, items: [...TEST_CATALOG.items, { id: 'h100-server', name: 'H100 서버', aliases: [] }] },
  products: [GCUBE_EDGE],
  items: [
    { id: 'credit', name: 'gcube 크레딧', unit: '식', listPriceMinor: null, section: '크레딧 충전', taxRate: 10 },
    { id: 'h100-server', name: 'H100 서버', unit: '대', listPriceMinor: BigInt(50_000_000), section: '하드웨어', taxRate: 10 },
  ],
  laborGrades: [],
  gpuPrice: () => null,
}

function countingAi(): CallAi & { calls: number } {
  const f = (async () => {
    f.calls += 1
    return { output: { readings: [{ ref: '1.0', role: 'ITEM' as const, itemId: 'h100-server', productId: null, edition: null, gpuModel: null, count: 2, months: null, hours: null, grade: null, manMonths: null, name: null, kind: null, alias: '에이치백' }] }, runId: 'run-1' }
  }) as CallAi & { calls: number }
  f.calls = 0
  return f
}

const input = (text: string, over: Record<string, unknown> = {}) => parseTextFillInput({ text, ...over })

test('규칙이 다 읽으면 AI 를 안 부른다', async () => {
  const ai = countingAi()
  const r = await fillCore(LOADED, input(SOOKMYUNG_LINES), ai)
  assert.equal(ai.calls, 0)
  assert.equal(r.aiStatus, 'NOT_NEEDED')
  assert.ok(r.ruleRatio >= 0.8)
  assert.ok(r.ops.some((o) => o.op === 'add' && /크레딧/.test(o.line.name)))
})

test('같은 글을 두 번이면 AI 호출 1번, 표 변화 0', async () => {
  const ai = countingAi()
  const text = '크레딧 1억\n에이치백 서버 두 대'
  const first = await fillCore(LOADED, input(text), ai)
  assert.equal(ai.calls, 1)
  assert.deepEqual(first.byAi, ['1.0'])
  // 화면은 받은 줄을 표에 얹고, 다음 번에 그 표와 지난 AI 답을 같이 보낸다
  const lines = first.ops.flatMap((o) => (o.op === 'add' ? [{
    key: o.line.textKey, textKey: o.line.textKey, itemId: o.line.itemId, name: o.line.name, kind: o.line.kind,
    section: o.line.section, quantity: String(o.line.quantity), unit: o.line.unit,
    unitPriceMinor: o.line.unitPriceMinor === null ? '' : String(o.line.unitPriceMinor), listPriceMinor: null,
    durationValue: '', durationUnit: '', ratioPct: null, ratioOfSectionName: null, remark: '', discountPercent: String(o.line.discountPercent), lockedFields: [],
  }] : []))
  const second = await fillCore(LOADED, input(text, { lines, aiCache: first.aiCache }), ai)
  assert.equal(ai.calls, 1)
  assert.equal(second.aiStatus, 'CACHED')
  assert.deepEqual(second.ops, [])
})

test('AI 가 한도에 걸려도 던지지 않고 규칙 결과를 돌려준다', async () => {
  const quota: CallAi = async () => { throw new CrmError('PROVIDER_QUOTA', 'quota') }
  const r = await fillCore(LOADED, input('크레딧 1억\n에이치백 서버 두 대'), quota)
  assert.equal(r.aiStatus, 'QUOTA')
  assert.ok(r.ops.some((o) => o.op === 'add' && /크레딧/.test(o.line.name)))
  assert.deepEqual(r.unread.map((u) => u.text), ['에이치백 서버 두 대'])
  const budget: CallAi = async () => { throw new CrmError('BUDGET_BLOCKED', 'budget') }
  assert.equal((await fillCore(LOADED, input('에이치백'), budget)).aiStatus, 'BUDGET')
})

test('ai off 면 부르지 않는다', async () => {
  const ai = countingAi()
  const r = await fillCore(LOADED, input('에이치백 서버 두 대', { ai: 'off' }), ai)
  assert.equal(ai.calls, 0)
  assert.equal(r.aiStatus, 'OFF')
})

test('글 길이 상한과 줄 수 상한을 넘으면 거절', () => {
  assert.throws(() => parseTextFillInput({ text: 'a'.repeat(8_001) }), (e: unknown) => e instanceof CrmError && e.code === 'VALIDATION_FAILED')
  assert.throws(() => parseTextFillInput({ text: '', lines: Array.from({ length: 201 }, () => ({})) }))
})
