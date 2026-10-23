import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRevision, parseEffectiveDay } from './revision.ts'

test('새 제품은 버전 1, 있던 제품은 하나 오른다', () => {
  assert.equal(nextRevision(null), 1)
  assert.equal(nextRevision({ revision: 1 }), 2)
  assert.equal(nextRevision({ revision: 7 }), 8)
  assert.equal(nextRevision({ revision: null }), 2, '값이 비었으면 1 로 보고 올린다')
})

test('적용일은 YYYY-MM-DD 이고 없는 날은 받지 않는다', () => {
  assert.equal(parseEffectiveDay('2026-11-01')?.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.equal(parseEffectiveDay('2026-02-30'), null)
  assert.equal(parseEffectiveDay('202611-01'), null)
  assert.equal(parseEffectiveDay(''), null)
  assert.equal(parseEffectiveDay(20261101), null)
})
