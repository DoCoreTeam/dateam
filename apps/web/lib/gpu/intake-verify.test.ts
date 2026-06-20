import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyItems } from './intake-verify.ts'
import type { ReconciledItem } from './intake-reconcile.ts'

function item(over: Partial<ReconciledItem>): ReconciledItem {
  return {
    model_name: 'T4', unit_price_usd: 0.81, original_price: 7000000, original_currency: 'KRW',
    original_unit: 'month', gpu_count: 8, term: 'on_demand', target: 'own_target',
    provenance: { model_addr: 'C7', price_addr: 'D7', block_id: 'b1' }, confidence: 0.9, issues: [],
    ...over,
  }
}

test('일관된 그룹(모두 0.81)은 auto', () => {
  const r = verifyItems([
    item({ provenance: { model_addr: 'C7', price_addr: 'D7', block_id: 'b1' } }),
    item({ gpu_count: 1, original_price: 875000, provenance: { model_addr: 'C17', price_addr: 'D17', block_id: 'b2' } }),
  ])
  assert.equal(r.needsHuman.length, 0)
  assert.equal(r.auto.length, 2)
})

test('핵심: 같은 T4 on_demand에 0.81과 6.48 공존 → 불일치 플래그 → 둘 다 needs_human', () => {
  const r = verifyItems([
    item({ unit_price_usd: 0.81 }),
    item({ unit_price_usd: 6.48, provenance: { model_addr: 'I27', price_addr: 'J27', block_id: 'b3' } }),
  ])
  assert.equal(r.needsHuman.length, 2)
  assert.ok(r.all.every((i) => i.verify_flags.includes('inconsistent_group')))
})

test('다른 약정(on_demand vs reserved)은 교차 불일치로 보지 않음', () => {
  const r = verifyItems([
    item({ term: 'on_demand', unit_price_usd: 0.81 }),
    item({ term: 'reserved_12m', unit_price_usd: 0.40 }),
  ])
  assert.equal(r.needsHuman.length, 0)
})

test('term 표기차(on_demand vs on-demand)도 같은 그룹으로 일관성 검사', () => {
  const r = verifyItems([
    item({ term: 'on_demand', unit_price_usd: 0.81 }),
    item({ term: 'on-demand', unit_price_usd: 6.48, provenance: { model_addr: 'I27', price_addr: 'J27', block_id: 'b3' } }),
  ])
  assert.equal(r.needsHuman.length, 2) // 표기 달라도 동일 그룹 → 불일치 검출
  assert.ok(r.all.every((i) => i.verify_flags.includes('inconsistent_group')))
})

test('consistency ratio 경계: 정확히 1.5는 미발동, 1.5 초과는 발동', () => {
  // 1.5 정확 (0.6 vs 0.9) → max/min=1.5, > 1.5 거짓 → auto
  const eq = verifyItems([item({ unit_price_usd: 0.6 }), item({ unit_price_usd: 0.9, provenance: { model_addr: 'a', price_addr: 'b', block_id: 'b2' } })])
  assert.equal(eq.needsHuman.length, 0)
  // 1.5 초과 (0.6 vs 0.91) → 발동
  const gt = verifyItems([item({ unit_price_usd: 0.6 }), item({ unit_price_usd: 0.91, provenance: { model_addr: 'a', price_addr: 'b', block_id: 'b2' } })])
  assert.equal(gt.needsHuman.length, 2)
})

test('저신뢰도 → needs_human', () => {
  const r = verifyItems([item({ confidence: 0.5 })])
  assert.equal(r.needsHuman.length, 1)
  assert.ok(r.all[0].verify_flags.includes('low_confidence'))
})

test('이슈 있는 레코드 → needs_human', () => {
  const r = verifyItems([item({ issues: ['unknown_currency'] })])
  assert.equal(r.needsHuman.length, 1)
  assert.ok(r.all[0].verify_flags.includes('has_issues'))
})
