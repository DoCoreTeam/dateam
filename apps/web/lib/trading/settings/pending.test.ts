import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendingByKey, editingValue } from './pending.ts'
import type { EffectiveRow } from './pick-effective.ts'

const TODAY = '2026-09-27'
const row = (key: string, value: EffectiveRow['value'], version: number, date: string): EffectiveRow =>
  ({ key, value, version, effective_trade_date: date })

test('예약이 없으면 지금 값만 있다', () => {
  const m = pendingByKey([row('a', 10, 1, '2026-09-20')], TODAY)
  assert.deepEqual(m.get('a'), { current: 10, next: null, from: null })
  assert.equal(editingValue(m.get('a')), 10)
})

test('예약이 있으면 둘 다 말한다 — 입력칸은 예약된 값을 쓴다', () => {
  const m = pendingByKey([
    row('a', 10, 1, '2026-09-20'),
    row('a', 20, 2, '2026-09-28'),
  ], TODAY)
  assert.deepEqual(m.get('a'), { current: 10, next: 20, from: '2026-09-28' })
  assert.equal(
    editingValue(m.get('a')), 20,
    '입력칸이 오늘 값을 그린다 — 저장하고 새로고침하면 방금 넣은 값이 사라진 것처럼 보인다',
  )
})

test('예약이 여럿이면 가장 큰 판이 이긴다 — 마지막에 누른 것이 뜻이다', () => {
  const m = pendingByKey([
    row('a', 10, 1, '2026-09-20'),
    row('a', 20, 2, '2026-09-28'),
    row('a', 30, 3, '2026-09-28'),
  ], TODAY)
  assert.equal(m.get('a')?.next, 30)
  assert.equal(m.get('a')?.current, 10, '예약이 오늘 값을 덮었다 — 그날 판단이 두 기준으로 갈린다')
})

test('유효일이 오늘인 줄은 예약이 아니라 지금 값이다', () => {
  const m = pendingByKey([
    row('a', 10, 1, '2026-09-20'),
    row('a', 20, 2, TODAY),
  ], TODAY)
  assert.deepEqual(m.get('a'), { current: 20, next: null, from: null })
})

test('키가 여럿이어도 섞이지 않는다', () => {
  const m = pendingByKey([
    row('a', 1, 1, '2026-09-20'),
    row('b', 2, 1, '2026-09-20'),
    row('b', 9, 2, '2026-09-30'),
  ], TODAY)
  assert.equal(m.get('a')?.next, null)
  assert.equal(m.get('b')?.next, 9)
})

test('참·거짓과 글자도 같은 규칙이다', () => {
  const m = pendingByKey([
    row('flag', false, 1, '2026-09-20'),
    row('flag', true, 2, '2026-09-30'),
    row('name', 'old', 1, '2026-09-20'),
    row('name', 'new', 2, '2026-09-30'),
  ], TODAY)
  assert.equal(editingValue(m.get('flag')), true)
  assert.equal(editingValue(m.get('name')), 'new')
})
