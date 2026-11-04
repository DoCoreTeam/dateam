import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEntries, parsePastedEntries, perGpuHour, resolveProductText, toExtracted, MAX_ENTRY_ROWS, type EntryProduct } from './entry.ts'

const TODAY = '2026-11-04'
const P: EntryProduct[] = [
  { id: 'h1', model_name: 'H100', memory: '80GB', gpu_count: 1 },
  { id: 'h8', model_name: 'H100', memory: '640GB', gpu_count: 8 },
  { id: 'nvl', model_name: 'H100 NVL', memory: '94GB', gpu_count: 1 },
  { id: 'r1', model_name: 'RTX 4090', memory: '24GB', gpu_count: 1 },
  { id: 'a6', model_name: 'RTX A2000', memory: '6GB', gpu_count: 1 },
  { id: 'a12', model_name: 'RTX A2000', memory: '12GB', gpu_count: 1 },
]
const ok = { kind: 'quote', vendor: '코난테크', product_id: 'h8', amount: 22400, currency: 'KRW', basis: 'total', period: 'hour', term: 'reserved_12m', received_on: '2026-11-01', source: 'mail' }

test('1장 1시간 값: 구성 전체는 장수로 나누고 월은 720시간, 분은 60배', () => {
  assert.equal(perGpuHour(22400, 'total', 'hour', 8), 2800)
  assert.equal(perGpuHour(2800, 'per_gpu', 'hour', 8), 2800)
  assert.equal(perGpuHour(720_000, 'per_gpu', 'month', 1), 1000)
  assert.equal(perGpuHour(10, 'per_gpu', 'minute', 1), 600)
})

test('맞는 줄은 장수와 1장 1시간 값을 붙여 돌려준다', () => {
  const { entries, errors } = validateEntries([ok], P, TODAY)
  assert.deepEqual(errors, [])
  assert.equal(entries[0].gpu_count, 8)
  assert.equal(entries[0].per_gpu_hour, 2800)
})

test('틀린 칸은 줄 번호와 칸 이름으로 전부 돌려준다', () => {
  const bad = { kind: 'x', vendor: ' ', product_id: 'nope', amount: -1, currency: 'JPY', basis: 'box', period: 'week', term: '1년', received_on: '2026-13-01', source: 'a'.repeat(501) }
  const { entries, errors } = validateEntries([ok, bad], P, TODAY)
  assert.equal(entries.length, 1)
  const fields = errors.filter((e) => e.line === 2).map((e) => `${e.field}:${e.code}`)
  assert.deepEqual(fields, [
    'kind:invalid', 'vendor:required', 'product_id:invalid', 'amount:out_of_range', 'currency:invalid',
    'basis:invalid', 'period:invalid', 'term:invalid', 'received_on:invalid', 'source:too_long',
  ])
})

test('비운 약정은 온디맨드, 비운 날짜는 오늘, 앞날은 받지 않는다', () => {
  const { entries } = validateEntries([{ ...ok, term: '', received_on: '' }], P, TODAY)
  assert.deepEqual([entries[0].term, entries[0].received_on], ['on_demand', TODAY])
  const { errors } = validateEntries([{ ...ok, received_on: '2026-11-05' }], P, TODAY)
  assert.deepEqual(errors.map((e) => e.field), ['received_on'])
})

test('1장 1시간이 상한을 넘으면 금액 칸이 틀린 것이다', () => {
  const { errors } = validateEntries([{ ...ok, currency: 'USD', amount: 1_000_000, basis: 'per_gpu' }], P, TODAY)
  assert.deepEqual(errors.map((e) => `${e.field}:${e.code}`), ['amount:out_of_range'])
})

test('모델 글을 상품 하나로 좁힌다, 안 좁혀지면 null', () => {
  assert.equal(resolveProductText('H100 80GB × 8', P), 'h8')
  assert.equal(resolveProductText('H100 x8', P), 'h8')
  assert.equal(resolveProductText('H100', P), 'h1')
  assert.equal(resolveProductText('h100 nvl', P), 'nvl')
  assert.equal(resolveProductText('RTX4090', P), 'r1')
  assert.equal(resolveProductText('RTX A2000', P), null) // 6GB 와 12GB 둘
  assert.equal(resolveProductText('RTX A2000 12GB', P), 'a12')
  assert.equal(resolveProductText('B200', P), null)
})

test('엑셀 붙여넣기: 머리줄이 있으면 그 순서, 없으면 기본 순서, 말은 값으로 바뀐다', () => {
  const withHeader = '모델\t공급사\t종류\t금액\t통화\t기준\t기간\t약정\t받은 날\n'
    + 'H100 × 8\t코난테크\t견적\t22,400\t원\t구성 전체\t시간\t1년 약정\t2026.11.1\n'
  const a = parsePastedEntries(withHeader, P)
  assert.deepEqual(a, [{ product_id: 'h8', vendor: '코난테크', kind: 'quote', amount: 22400, currency: 'KRW', basis: 'total', period: 'hour', term: 'reserved_12m', received_on: '2026-11-01' }])

  const noHeader = '시세\tRunPod\tRTX 4090\t$0.69\tUSD\t1장\thr\ton-demand\t2026-11-03\thttps://runpod.io/pricing\r\n\r\n'
  const b = parsePastedEntries(noHeader, P)
  assert.equal(b.length, 1)
  assert.deepEqual(b[0], { kind: 'market', vendor: 'RunPod', product_id: 'r1', amount: 0.69, currency: 'USD', basis: 'per_gpu', period: 'hour', term: 'on_demand', received_on: '2026-11-03', source: 'https://runpod.io/pricing' })
  assert.deepEqual(validateEntries(b, P, TODAY).errors, [])
})

test('붙여넣기에서 못 읽은 칸은 검증에서 틀린 칸으로 잡힌다 (조용히 버리지 않음)', () => {
  const rows = parsePastedEntries('견적\tA\tB200\t열\t엔\t박스\t주\n', P)
  const fields = validateEntries(rows, P, TODAY).errors.map((e) => e.field)
  assert.deepEqual(fields, ['product_id', 'amount', 'currency', 'basis', 'period'])
})

test('붙여넣기도 한 번에 최대 줄 수까지만', () => {
  const text = Array.from({ length: MAX_ENTRY_ROWS + 5 }, () => '견적\tA\tH100\t1\tKRW\t1장\t시간').join('\n')
  assert.equal(parsePastedEntries(text, P).length, MAX_ENTRY_ROWS)
})

test('견적 저장 꼴: 원래 금액은 구성 전체 시간당(KRW/hr), 달러 단가는 1장', () => {
  const e = validateEntries([ok], P, TODAY).entries[0]
  const x = toExtracted(e, P[1], 1400)
  assert.equal(x.supplier, '코난테크')
  assert.equal(x.original_price, 22400)
  assert.equal(x.original_unit, 'KRW/hr')
  assert.equal(x.unit_price_usd, 2)
  assert.equal(x.gpu_count, 8)
  assert.deepEqual([x.term, x.term_months], ['reserved_12m', 12])
  assert.equal(x.received_at, '2026-11-01T00:00:00+09:00')
  assert.equal((x.entry as Record<string, unknown>).basis, 'total')
})

test('시세 저장 꼴: 관측 원본(금액 통화 기간 장수)을 그대로 싣는다', () => {
  const e = validateEntries([{ ...ok, kind: 'market', vendor: 'Elice', amount: 84000, period: 'hour', term: 'on_demand' }], P, TODAY).entries[0]
  const x = toExtracted(e, P[1], 1400)
  assert.equal(x.competitor_name, 'Elice')
  assert.equal(x.price_usd, 7.5)
  assert.equal(x.pricing_model, 'on_demand')
  assert.deepEqual(x.obs, { amount: 84000, currency: 'KRW', pricing_unit: 'hour', gpu_count: 8, observed_at: '2026-11-01T00:00:00+09:00' })
})
