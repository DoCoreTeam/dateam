import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme } from './themes.ts'

// resolveTheme(userPref, globalDefault): 개인 선택 우선, 무효/없음이면 디폴트 폴백

test('유효한 개인 테마는 그대로 반환', () => {
  assert.equal(resolveTheme('mono', 'nb'), 'mono')
  assert.equal(resolveTheme('classic', 'nb'), 'classic')
  assert.equal(resolveTheme('nb', 'classic'), 'nb')
})

test('null/undefined 개인 테마는 전역 디폴트로 폴백', () => {
  assert.equal(resolveTheme(null, 'classic'), 'classic')
  assert.equal(resolveTheme(undefined, 'mono'), 'mono')
})

test('무효값(레지스트리에 없는 id)은 전역 디폴트로 폴백', () => {
  assert.equal(resolveTheme('does-not-exist', 'nb'), 'nb')
  assert.equal(resolveTheme('', 'classic'), 'classic')
  assert.equal(resolveTheme('NB', 'mono'), 'mono') // 대소문자 구분
})
