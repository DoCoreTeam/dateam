import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeChanges, normalizeType, isVersionLike, isIsoDate, sanitizeSearch, STRICT_VERSION_RE } from './normalize.ts'

test('sanitizeSearch — 구조문자(,()*\\)만 제거, 점·하이픈 보존', () => {
  assert.equal(sanitizeSearch('x,is_published.eq.false'), 'x is_published.eq.false') // 콤마만 제거
  assert.equal(sanitizeSearch('a)b(c*'), 'a b c') // 괄호·별 제거
  assert.equal(sanitizeSearch('0.7.197'), '0.7.197') // 버전 점 보존(검색 가능)
  assert.equal(sanitizeSearch('H100 가격-표'), 'H100 가격-표')
})

test('isVersionLike — 수동입력 허용/차단', () => {
  assert.equal(isVersionLike('0.7.197'), true)
  assert.equal(isVersionLike('0.0.0-e2e'), true)
  assert.equal(isVersionLike('1.0.0-hotfix.1'), true)
  assert.equal(isVersionLike('drop table; --'), false)
  assert.equal(isVersionLike(''), false)
})

test('STRICT_VERSION_RE — git 자동수집 엄격', () => {
  assert.equal(STRICT_VERSION_RE.test('0.7.197'), true)
  assert.equal(STRICT_VERSION_RE.test('0.0.0-e2e'), false)
})

test('isIsoDate', () => {
  assert.equal(isIsoDate('2026-06-18'), true)
  assert.equal(isIsoDate('2026/06/18'), false)
  assert.equal(isIsoDate('bad'), false)
})

test('sanitizeChanges — text트림·빈값제거·type화이트·상한50', () => {
  const out = sanitizeChanges([{ text: ' a ', type: 'fix' }, { text: '', type: 'x' }, { text: 'b' }])
  assert.equal(out.length, 2)
  assert.equal(out[0].text, 'a')
  assert.equal(out[0].type, 'fix')
  assert.equal(out[1].type, 'feature') // 미지정/잘못된 type → feature
})

test('normalizeType', () => {
  assert.equal(normalizeType('improve'), 'improve')
  assert.equal(normalizeType('bogus'), 'feature')
})
