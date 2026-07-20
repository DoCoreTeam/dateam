import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toKrwPerGpuHour, krwPerGpuHourToUsd } from './observation-normalize.ts'

const FX = { JPY: 9.5, USD: 1342.5, KRW: 1 } // 1엔=9.5원, 1달러=1342.5원

test('소프트뱅크 H100 ¥2,500,000/월·8장(번들) → per-GPU·hr KRW', () => {
  // 2,500,000×9.5 = 23,750,000원 ÷720h ÷8장
  const r = toKrwPerGpuHour({ amount: 2_500_000, currency: 'JPY', pricing_unit: 'month', gpu_count: 8 }, FX)!
  assert.equal(Math.round(r.krw_per_gpu_hour), Math.round(23_750_000 / 720 / 8)) // ≈4123원
  assert.equal(r.fx_applied, 9.5)
})

test('소프트뱅크 A100 시간제 7.2円/분·1장 → per-GPU·hr KRW', () => {
  // 7.2×9.5=68.4원/분 ×60 = 4104원/hr ÷1장
  const r = toKrwPerGpuHour({ amount: 7.2, currency: 'JPY', pricing_unit: 'minute', gpu_count: 1 }, FX)!
  assert.equal(Math.round(r.krw_per_gpu_hour), Math.round(7.2 * 9.5 * 60))
})

test('USD 노드 $24/hr·8장 → per-GPU·hr ($3/GPU·hr 상당)', () => {
  const r = toKrwPerGpuHour({ amount: 24, currency: 'USD', pricing_unit: 'hour', gpu_count: 8 }, FX)!
  assert.equal(r.krw_per_gpu_hour, (24 * 1342.5) / 1 / 8) // 3 × 1342.5
  assert.equal(Math.round(krwPerGpuHourToUsd(r.krw_per_gpu_hour, FX)!), 3)
})

test('KRW 원본은 환율 1로 그대로', () => {
  const r = toKrwPerGpuHour({ amount: 2400, currency: 'KRW', pricing_unit: 'hour', gpu_count: 1 }, FX)!
  assert.equal(r.krw_per_gpu_hour, 2400)
  assert.equal(r.fx_applied, 1)
})

test('환율 미보유 통화·불량입력 → null(보류)', () => {
  assert.equal(toKrwPerGpuHour({ amount: 100, currency: 'EUR', pricing_unit: 'hour', gpu_count: 1 }, FX), null) // EUR 맵에 없음
  assert.equal(toKrwPerGpuHour({ amount: 100, currency: 'JPY', pricing_unit: 'hour', gpu_count: 0 }, FX), null) // 장수 0
  assert.equal(toKrwPerGpuHour({ amount: 0, currency: 'JPY', pricing_unit: 'hour', gpu_count: 1 }, FX), null)
})

test('이원화 — 같은 원본, 다른 fx맵이면 다른 결과(표시=최신 vs 판가=스냅샷)', () => {
  const latest = { JPY: 9.8, KRW: 1 }
  const snapshot = { JPY: 9.5, KRW: 1 }
  const obs = { amount: 2_500_000, currency: 'JPY', pricing_unit: 'month' as const, gpu_count: 8 }
  const a = toKrwPerGpuHour(obs, latest)!.krw_per_gpu_hour
  const b = toKrwPerGpuHour(obs, snapshot)!.krw_per_gpu_hour
  assert.ok(a > b) // 엔고(9.8)면 표시가 더 큼 — 원본에서 재환산됨(이중환산 아님)
})
