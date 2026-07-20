import { test } from 'node:test'
import assert from 'node:assert/strict'
import { componentToKrwPerGpuHour, toComponentRow, type PriceComponent } from './price-components.ts'

const fx = { JPY: 9.5, USD: 1400, KRW: 1 }

test('flat 월정액 번들 → per-GPU·hr KRW (÷720÷장수)', () => {
  const c: PriceComponent = { component_kind: 'flat', amount: 2_500_000, currency: 'JPY', unit: 'month', gpu_count: 8 }
  // 2,500,000 × 9.5 / 720 / 8
  assert.ok(Math.abs(componentToKrwPerGpuHour(c, fx)! - (2_500_000 * 9.5) / 720 / 8) < 1e-6)
})

test('usage 분당 종량(1장) → per-GPU·hr KRW (×60)', () => {
  const c: PriceComponent = { component_kind: 'usage', amount: 7.2, currency: 'JPY', unit: 'minute', gpu_count: 1 }
  assert.ok(Math.abs(componentToKrwPerGpuHour(c, fx)! - 7.2 * 9.5 * 60) < 1e-6)
})

test('base_fee(per_account)·storage(per_gb)는 시간환산 불가 → null', () => {
  assert.equal(componentToKrwPerGpuHour({ component_kind: 'base_fee', amount: 30000, currency: 'JPY', unit: 'per_account' }, fx), null)
  assert.equal(componentToKrwPerGpuHour({ component_kind: 'storage', amount: 1000, currency: 'JPY', unit: 'per_gb' }, fx), null)
})

test('환율 미보유 통화 → null(보류)', () => {
  assert.equal(componentToKrwPerGpuHour({ component_kind: 'flat', amount: 100, currency: 'EUR', unit: 'month', gpu_count: 1 }, {}), null)
})

test('toComponentRow — DB 컬럼 직렬화(fx 스냅샷·기본 tax unknown)', () => {
  const row = toComponentRow({ component_kind: 'usage', amount: 7.2, currency: 'JPY', unit: 'minute', gpu_count: 1 }, { rate: 9.5, date: '2026-07-20', source: 'koreaexim' })
  assert.equal(row.component_kind, 'usage')
  assert.equal(row.fx_rate, 9.5)
  assert.equal(row.tax_basis, 'unknown')
})
