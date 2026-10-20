import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { baselineCheck } from '../domain/pricebook/baseline-check.ts'
import { composeFromText } from '../domain/quote-text/compose-from-text.ts'
import { readText } from '../domain/quote-text/read-rules.ts'
import { buildGpuPriceLookup, type GpuConfigRow } from './gpu-price-ref.ts'

const ROWS: GpuConfigRow[] = [
  { model_name: 'RTX 5090', gpu_count: 8, strategic_krw: 8_800, is_active: true },
  { model_name: 'RTX 5090', gpu_count: 1, strategic_krw: 1_300, is_active: true },
  { model_name: 'H100 SXM', gpu_count: 8, strategic_krw: 40_000, is_active: true },
  { model_name: 'H100 SXM', gpu_count: 4, strategic_krw: 24_000, is_active: true },
  { model_name: 'B200', gpu_count: 1, strategic_krw: 9_000, is_active: false },
  { model_name: 'A100', gpu_count: 1, strategic_krw: null, is_active: true },
]

test('1장 구성을 먼저, 없으면 1장당 가장 낮은 구성', () => {
  const find = buildGpuPriceLookup(ROWS)
  assert.deepEqual(find('RTX 5090'), { model: 'RTX 5090', hourlyKrw: 1_300, gpuCount: 1 })
  assert.deepEqual(find('NVIDIA H100 SXM'), { model: 'H100 SXM', hourlyKrw: 40_000, gpuCount: 8 })
})

test('숨긴 구성과 판매가 없는 구성은 없음', () => {
  const find = buildGpuPriceLookup(ROWS)
  assert.equal(find('B200'), null)
  assert.equal(find('A100'), null)
  assert.equal(find('L40S'), null)
})

test('RTX 5090 17대 2개월은 판매가로 31,824,000원, 없으면 가격표에 없음', () => {
  const find = buildGpuPriceLookup(ROWS)
  const q = composeFromText(readText('RTX 5090 17대 2개월\nB200 2대 1개월', { products: [], items: [] }), {
    products: [], items: [], laborGrades: [], gpuPrice: find, companyKind: null,
  })
  const l = q.lines.find((x) => /5090/.test(x.name))!
  assert.equal(l.unitPriceMinor, BigInt(1_300 * 720))
  assert.equal(Number(l.unitPriceMinor) * l.quantity * (l.durationValue ?? 1), 31_824_000)
  const none = q.lines.find((x) => /B200/.test(x.name))!
  assert.equal(none.unitPriceMinor, null)
  assert.equal(none.provenance.unitPrice.note, '가격표에 없음')
})

test('GPU 이용 줄 단가가 판매가와 다르면 기준 대조가 알린다', () => {
  const f = baselineCheck([{ name: 'RTX 5090 GPU 이용', unitPriceMinor: '900000', listPriceMinor: String(1_300 * 720), priceSource: 'GPU' }])
  assert.equal(f.length, 1)
  assert.equal(f[0].level, 'warn')
  assert.match(f[0].message, /정상가/)
})

test('서비스롤 읽기는 서버 전용 파일 하나에만', () => {
  const src = readFileSync(new URL('./gpu-price-ref-load.ts', import.meta.url), 'utf8')
  assert.match(src, /^import 'server-only'/m)
  const pure = readFileSync(new URL('./gpu-price-ref.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(pure, /createAdminClient|supabase/)
})
