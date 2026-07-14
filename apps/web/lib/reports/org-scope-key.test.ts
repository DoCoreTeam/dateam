import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orgScopeKey } from './org-scope-key.ts'

test('전체 조직 = all', () => {
  assert.equal(orgScopeKey(null, null), 'all')
  assert.equal(orgScopeKey('', []), 'all')
})

test('개인 = member:<uid>', () => {
  assert.equal(orgScopeKey('u1', null), 'member:u1')
})

test('부서필터가 member보다 우선', () => {
  assert.ok(orgScopeKey('u1', ['a', 'b']).startsWith('dept:'))
})

test('부서필터는 멤버 순서와 무관하게 동일 키(정렬 안정성)', () => {
  assert.equal(orgScopeKey(null, ['b', 'a', 'c']), orgScopeKey(null, ['a', 'b', 'c']))
})

test('멤버 구성이 다르면 키가 다름', () => {
  assert.notEqual(orgScopeKey(null, ['a', 'b']), orgScopeKey(null, ['a', 'c']))
})

test('공백/빈 항목 정규화 후 동일 키', () => {
  assert.equal(orgScopeKey(null, [' a ', '', 'b']), orgScopeKey(null, ['a', 'b']))
})
