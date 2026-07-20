import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveMonthlyKrwPerGpu, effectiveKrwPerGpuHour, STANDARD_SCENARIO, type CostScenario } from './scenario-cost.ts'
import type { PriceComponent } from './price-components.ts'

const fx = { JPY: 9.5, KRW: 1 }
// 스토리지 0으로 두면 flat/usage만 비교(순수 GPU 비용 축).
const noStorage: CostScenario = { gpuHoursPerMonth: STANDARD_SCENARIO.gpuHoursPerMonth, storageGb: 0 }

test('flat 월정액 번들 1장 월 실효비용 = 총액×fx÷장수', () => {
  const comps: PriceComponent[] = [{ component_kind: 'flat', amount: 2_500_000, currency: 'JPY', unit: 'month', gpu_count: 8 }]
  assert.ok(Math.abs(effectiveMonthlyKrwPerGpu(comps, fx, noStorage)! - (2_500_000 * 9.5) / 8) < 1e-6)
})

test('시간제 복합(기본료+종량) 월 실효비용 = 기본료 + 종량×월가동시간', () => {
  const comps: PriceComponent[] = [
    { component_kind: 'base_fee', amount: 30_000, currency: 'JPY', unit: 'per_account' },
    { component_kind: 'usage', amount: 7.2, currency: 'JPY', unit: 'minute', gpu_count: 1 },
  ]
  // 30000×9.5 + (7.2×9.5/(1/60))×720
  const expect = 30_000 * 9.5 + (7.2 * 9.5 / (1 / 60)) * STANDARD_SCENARIO.gpuHoursPerMonth
  assert.ok(Math.abs(effectiveMonthlyKrwPerGpu(comps, fx, noStorage)! - expect) < 1e-3)
})

test('스토리지 성분 포함 시나리오', () => {
  const comps: PriceComponent[] = [{ component_kind: 'storage', amount: 1000, currency: 'JPY', unit: 'per_gb' }]
  // 1000×9.5 × 500GB
  assert.ok(Math.abs(effectiveMonthlyKrwPerGpu(comps, fx, { gpuHoursPerMonth: 720, storageGb: 500 })! - 1000 * 9.5 * 500) < 1e-6)
})

test('환율 미보유 성분 → null(불완전)', () => {
  assert.equal(effectiveMonthlyKrwPerGpu([{ component_kind: 'flat', amount: 1, currency: 'EUR', unit: 'month', gpu_count: 1 }], fx), null)
})

test('effectiveKrwPerGpuHour = 월 실효 ÷ 가동시간', () => {
  const comps: PriceComponent[] = [{ component_kind: 'flat', amount: 1_500_000, currency: 'JPY', unit: 'month', gpu_count: 8 }]
  const hr = effectiveKrwPerGpuHour(comps, fx, noStorage)!
  assert.ok(Math.abs(hr - ((1_500_000 * 9.5) / 8) / 720) < 1e-6)
})

// [회귀고정 v0.7.351] 정액 반복요금(base_fee·flat)의 주기 정규화 — 미정규화 시 배수 오차.
//   年額 기본료를 그대로 월비용에 더하면 12배 과대계상되던 버그(DC-QA 지적).
//   또한 시간비(8760/720=12.167)로 환산하면 +1.4% 오차 → 정액요금은 달력 계수(÷12)가 정답.
test('base_fee 年額 → 월액 정규화(÷12, 시간비 아님)', () => {
  const r = effectiveMonthlyKrwPerGpu([{ component_kind: 'base_fee', amount: 120_000, currency: 'JPY', unit: 'year' }], fx)!
  assert.ok(Math.abs(r - (120_000 * 9.5) / 12) < 1e-6, `기대 ${(120_000 * 9.5) / 12}, 실제 ${r}`)
})

test('flat 年額도 동일 달력 계수 — base_fee와 일관', () => {
  const r = effectiveMonthlyKrwPerGpu([{ component_kind: 'flat', amount: 120_000, currency: 'JPY', unit: 'year', gpu_count: 1 }], fx)!
  assert.ok(Math.abs(r - (120_000 * 9.5) / 12) < 1e-6)
})

test('base_fee 日額 → ×30(월=30일 규약과 일관)', () => {
  const r = effectiveMonthlyKrwPerGpu([{ component_kind: 'base_fee', amount: 1_000, currency: 'JPY', unit: 'day' }], fx)!
  assert.ok(Math.abs(r - 1_000 * 9.5 * 30) < 1e-6, `기대 ${1_000 * 9.5 * 30}, 실제 ${r}`)
})

test('base_fee per_account(주기 미상) → 월액 그대로(기존 동작 유지)', () => {
  const r = effectiveMonthlyKrwPerGpu([{ component_kind: 'base_fee', amount: 30_000, currency: 'JPY', unit: 'per_account' }], fx)!
  assert.ok(Math.abs(r - 30_000 * 9.5) < 1e-6)
})
