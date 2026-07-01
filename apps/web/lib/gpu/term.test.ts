import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTerm, isOnDemand, termLabel } from './term.ts'

test('빈값/미지정 → on_demand', () => {
  assert.equal(normalizeTerm(''), 'on_demand')
  assert.equal(normalizeTerm(null), 'on_demand')
  assert.equal(normalizeTerm(undefined), 'on_demand')
})

test('on-demand 표기 변형 흡수', () => {
  assert.equal(normalizeTerm('on_demand'), 'on_demand')
  assert.equal(normalizeTerm('on-demand'), 'on_demand')
  assert.equal(normalizeTerm('OnDemand'), 'on_demand')
  assert.equal(normalizeTerm('OD'), 'on_demand')
})

test('spot 계열', () => {
  assert.equal(normalizeTerm('spot'), 'spot')
  assert.equal(normalizeTerm('Preemptible'), 'spot')
})

test('개월 수 있는 약정 → reserved_Nm', () => {
  assert.equal(normalizeTerm('reserved_6m'), 'reserved_6m')
  assert.equal(normalizeTerm('reserved_12m'), 'reserved_12m')
  assert.equal(normalizeTerm('6개월'), 'reserved_6m')
  assert.equal(normalizeTerm('6 months'), 'reserved_6m')
  assert.equal(normalizeTerm('12mo'), 'reserved_12m')
})

test('연 단위 → 개월 환산', () => {
  assert.equal(normalizeTerm('1년'), 'reserved_12m')
  assert.equal(normalizeTerm('1 year'), 'reserved_12m')
  assert.equal(normalizeTerm('3년 약정'), 'reserved_36m')
})

test('기간 불명 reserved', () => {
  assert.equal(normalizeTerm('reserved'), 'reserved')
  assert.equal(normalizeTerm('약정'), 'reserved')
  assert.equal(normalizeTerm('committed'), 'reserved')
})

test('알 수 없는 표기는 정규화 원문 보존(무음 폐기 금지)', () => {
  assert.equal(normalizeTerm('flex-plan'), 'flexplan')
})

test('isOnDemand', () => {
  assert.equal(isOnDemand(''), true)
  assert.equal(isOnDemand('reserved_6m'), false)
  assert.equal(isOnDemand('OD'), true)
})

test('termLabel — 사람이 읽는 라벨', () => {
  assert.equal(termLabel('on_demand'), '온디맨드')
  assert.equal(termLabel('spot'), '스팟')
  assert.equal(termLabel('reserved_6m'), '약정 6개월')
  assert.equal(termLabel('reserved_12m'), '약정 1년')
  assert.equal(termLabel('reserved_36m'), '약정 3년')
  assert.equal(termLabel('reserved'), '약정')
})
