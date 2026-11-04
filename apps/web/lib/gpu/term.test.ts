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
  assert.equal(termLabel('reserved_6m'), '6개월 약정')
  assert.equal(termLabel('reserved_12m'), '1년 약정')
  assert.equal(termLabel('reserved_36m'), '3년 약정')
  assert.equal(termLabel('reserved'), '약정')
})

test('줄표와 영어 수사도 읽는다 — 원문 이어쓰기(12monthterm)가 화면에 뜨지 않게', () => {
  assert.equal(normalizeTerm('12-month term'), 'reserved_12m')
  assert.equal(normalizeTerm('3-month term'), 'reserved_3m')
  assert.equal(normalizeTerm('one-year contract'), 'reserved_12m')
  assert.equal(normalizeTerm('One year contract'), 'reserved_12m')
  assert.equal(termLabel(normalizeTerm('12-month term')), '1년 약정')
  assert.equal(termLabel(normalizeTerm('6-month term')), '6개월 약정')
  assert.equal(termLabel(normalizeTerm('30 days')), '30일')
  assert.equal(normalizeTerm('someone year'), 'someoneyear') // 낱말 일부는 수사로 안 읽는다
})
