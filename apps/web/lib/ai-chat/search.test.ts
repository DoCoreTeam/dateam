import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSearchQuery } from './search.ts'

test('① ilike 메타문자 % _ \\ 이스케이프', () => {
  assert.equal(sanitizeSearchQuery('50% off'), '50\\% off')
  assert.equal(sanitizeSearchQuery('a_b'), 'a\\_b')
  assert.equal(sanitizeSearchQuery('c\\d'), 'c\\\\d')
  // 혼합 — 각 메타문자가 정확히 1회씩만 이스케이프(이중 이스케이프 없음)
  assert.equal(sanitizeSearchQuery('%_\\'), '\\%\\_\\\\')
})

test('② 1자 → null', () => {
  assert.equal(sanitizeSearchQuery('a'), null)
  assert.equal(sanitizeSearchQuery(' x '), null) // trim 후 1자
})

test('③ 101자 → null (고정 동작 — 절단 아님)', () => {
  assert.equal(sanitizeSearchQuery('a'.repeat(101)), null)
  // 경계: 정확히 100자는 통과
  const boundary = 'b'.repeat(100)
  assert.equal(sanitizeSearchQuery(boundary), boundary)
})

test('④ 앞뒤 공백 trim', () => {
  assert.equal(sanitizeSearchQuery('  hello  '), 'hello')
})

test('⑤ 한글/유니코드 통과', () => {
  assert.equal(sanitizeSearchQuery('안녕하세요'), '안녕하세요')
  assert.equal(sanitizeSearchQuery('  검색어  '), '검색어')
  assert.equal(sanitizeSearchQuery('日本語'), '日本語')
})

test('⑥ 빈 문자열 → null', () => {
  assert.equal(sanitizeSearchQuery(''), null)
  assert.equal(sanitizeSearchQuery('     '), null) // 공백만 → trim 후 빈 문자열
})
