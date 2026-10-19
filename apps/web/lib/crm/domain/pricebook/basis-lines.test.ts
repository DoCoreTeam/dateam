import { test } from 'node:test'
import assert from 'node:assert/strict'
import { laborLine, gpuUsageLine, costMarginLine, pickFirst, medianPct, PUBLIC_LABOR_RATES_KRW } from './basis-lines.ts'
import { computeLine } from '../quote-math.ts'
import { DEFAULT_RULES } from '../../../rfp/anomaly/rules.ts'

test('★ 정답 3: GPU 톡키 — RTX 5090 17대 × 2개월, 시간당 1,300원이면 31,824,000원', () => {
  const l = gpuUsageLine({ model: 'RTX 5090', count: 17, months: 2 }, { model: 'RTX 5090', hourlyKrw: 1300, gpuCount: 1 })!
  assert.equal(l.unitPriceMinor, BigInt(936_000), '월 단가는 시간당 × 720')
  const a = computeLine(l)
  assert.equal(a.lineTotalMinor, BigInt(31_824_000))
  assert.equal(l.provenance.unitPrice.source, 'GPU_PRICE')
})

test('GPU 구성이 8장이면 1장당으로 나눈다', () => {
  const l = gpuUsageLine({ model: 'H100', count: 1, months: 1 }, { model: 'H100', hourlyKrw: 80_000, gpuCount: 8 })!
  assert.equal(l.unitPriceMinor, BigInt(10_000 * 720))
})

test('GPU 기간을 말하지 않으면 1개월로 채우고 출처를 단다', () => {
  const l = gpuUsageLine({ model: 'RTX 5090', count: 1, months: null }, { model: 'RTX 5090', hourlyKrw: 1300, gpuCount: 1 })!
  assert.equal(l.durationValue, 1)
  assert.equal(l.autoFilled[0].field, '기간')
})

test('GPU 판매가가 없고 말한 값도 없으면 줄을 못 만든다 — 지어내지 않는다', () => {
  assert.equal(gpuUsageLine({ model: 'X', count: 1, months: 1 }, null), null)
})

test('★ 고급 2 M/M, 우리 판매 단가가 없으면 공표 노임단가 7,800,000원으로 15,600,000원', () => {
  const l = laborLine('SSO, 정산 연동 개발', { grade: '고급', headcount: null, months: 2 }, [])!
  assert.equal(l.unitPriceMinor, BigInt(7_800_000))
  assert.equal(computeLine(l).lineTotalMinor, BigInt(15_600_000))
  assert.equal(l.provenance.unitPrice.source, 'PUBLIC_LABOR')
  assert.ok(l.autoFilled.some((a) => a.field === '고급 등급 단가'))
})

test('우리 판매 단가가 있으면 공표값보다 먼저다, 말한 값은 그보다 먼저다', () => {
  const grades = [{ id: 'g1', name: '고급', pricePerMmMinor: BigInt(9_000_000) }]
  assert.equal(laborLine('개발', { grade: '고급', headcount: 1, months: 1 }, grades)!.unitPriceMinor, BigInt(9_000_000))
  assert.equal(laborLine('개발', { grade: '고급', headcount: 1, months: 1, saidUnitPriceMinor: BigInt(5_000_000) }, grades)!.unitPriceMinor, BigInt(5_000_000))
})

test('등급을 말하지 않으면 중급, 인원은 1명', () => {
  const l = laborLine('개발', { grade: null, headcount: null, months: 3 }, [])!
  assert.equal(l.unitPriceMinor, BigInt(6_200_000))
  assert.equal(l.quantity, 3)
})

test('공표 노임단가는 RFP R06 기본값과 같은 한 벌이다', () => {
  const r06 = DEFAULT_RULES.find((r) => r.id === 'R06')!
  assert.deepEqual((r06.params as { laborRateKrwPerMonth: unknown }).laborRateKrwPerMonth, PUBLIC_LABOR_RATES_KRW)
})

test('원가와 마진율: 마진율은 같은 품목 지난 견적 → 하드웨어 가운데 값 → 기본값', () => {
  const a = costMarginLine({ name: '서버', quantity: 1, unit: '대', costMinor: 8_000_000, lastQuoteMarginPct: 20, peerMarginPcts: [10], fallbackMarginPct: 18 })
  assert.equal(a.unitPriceMinor, BigInt(10_000_000))
  assert.equal(a.autoFilled[0].provenance.source, 'LAST_QUOTE')
  const b = costMarginLine({ name: '서버', quantity: 1, unit: '대', costMinor: 9_000_000, peerMarginPcts: [5, 10, 40], fallbackMarginPct: 18 })
  assert.equal(b.unitPriceMinor, BigInt(10_000_000))
  const c = costMarginLine({ name: '서버', quantity: 1, unit: '대', costMinor: 8_200_000, fallbackMarginPct: 18 })
  assert.equal(c.unitPriceMinor, BigInt(10_000_000))
})

test('채우는 순서 — 사람이 고친 값이 언제나 이긴다', () => {
  const r = pickFirst<number>([
    { value: 3, provenance: { source: 'DEFAULT' } },
    { value: 2, provenance: { source: 'SAID' } },
    { value: 1, provenance: { source: 'HUMAN' } },
    { value: 4, provenance: { source: 'BUDGET' } },
  ])
  assert.equal(r?.value, 1)
  assert.equal(pickFirst<number>([{ value: null, provenance: { source: 'HUMAN' } }, { value: 7, provenance: { source: 'DEFAULT' } }])?.value, 7)
  assert.equal(medianPct([1, 3, 2, 4]), 2.5)
})
