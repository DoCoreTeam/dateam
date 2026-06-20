import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickSupplyCostKrw, pickListSupplierName, pickCostSupplierName } from './unified-cost-pick.ts'

// 핵심 회귀 보호: 가격-지정(is_selected) 수정분(v0.7.218~219).
// 실제 사고: 지정 NHN인데 리스트가 최저가 Equinix를 표시 / 기준 공급원가가 만료 최저가로 계산.

// ── pickSupplyCostKrw: 가격결정 기준 공급원가 ──
test('기준 공급원가 = cost_basis(지정/실효) 우선 — 절대최저 아님', () => {
  assert.equal(pickSupplyCostKrw(3565, 2971), 3565) // 지정 NHN ₩3,565, 만료최저 ₩2,971 무시
})
test('기준 공급원가 = cost_min 폴백(cost_basis null/undefined)', () => {
  assert.equal(pickSupplyCostKrw(null, 2971), 2971)
  assert.equal(pickSupplyCostKrw(undefined, 2971), 2971)
})
test('기준 공급원가 = 0도 유효값(폴백 금지 — ?? 사용)', () => {
  assert.equal(pickSupplyCostKrw(0, 2971), 0)
})
test('기준 공급원가 둘 다 없으면 null', () => {
  assert.equal(pickSupplyCostKrw(null, null), null)
})

// ── pickListSupplierName: 리스트 라벨/검색/정렬 공급사 ──
test('리스트 공급사 = 지정/실효 공급사 우선 — 최저가 공급사 아님', () => {
  assert.equal(pickListSupplierName('NHN Cloud', 'Equinix Metal'), 'NHN Cloud')
})
test('리스트 공급사 = 최저가 폴백(실효 공급사 없음)', () => {
  assert.equal(pickListSupplierName(null, 'Equinix Metal'), 'Equinix Metal')
})

// ── pickCostSupplierName: 상세 패널 기준 공급사 ──
test('상세 기준 공급사 = 지정/실효 우선', () => {
  assert.equal(pickCostSupplierName('Voltage Park', false, 'Equinix Metal'), 'Voltage Park')
})
test('상세 기준 공급사 = 최저가 폴백(비전파, 실효 없음)', () => {
  assert.equal(pickCostSupplierName(null, false, 'Equinix Metal'), 'Equinix Metal')
})
test('상세 기준 공급사 = 전파면 폴백 금지(자기참조 라벨 방지)', () => {
  assert.equal(pickCostSupplierName(null, true, 'Equinix Metal'), null)
})
