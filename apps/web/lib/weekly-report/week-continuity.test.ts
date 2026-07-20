import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMondayStr, resolveSelectedWeek, clampToWindow, tabEffectiveWeek } from './week-continuity.ts'

// 고정 8주 옵션(월요일들) — Date.now 불필요.
const OPTS = ['2026-07-13', '2026-07-06', '2026-06-29', '2026-06-22', '2026-06-15', '2026-06-08', '2026-06-01', '2026-05-25']
const THIS = OPTS[0]

test('isMondayStr: 월요일만 true', () => {
  assert.equal(isMondayStr('2026-07-13'), true) // 월
  assert.equal(isMondayStr('2026-07-14'), false) // 화
  assert.equal(isMondayStr('2026/07/13'), false)
  assert.equal(isMondayStr(undefined), false)
  assert.equal(isMondayStr('bad'), false)
})

test('resolveSelectedWeek: 윈도우 내 주차 채택', () => {
  assert.equal(resolveSelectedWeek('2026-06-15', OPTS), '2026-06-15')
})

test('resolveSelectedWeek: 윈도우 밖 유효 월요일도 채택(org 무제한)', () => {
  assert.equal(resolveSelectedWeek('2026-01-05', OPTS), '2026-01-05') // 월요일
})

test('resolveSelectedWeek: 무효/미지정 → 이번주', () => {
  assert.equal(resolveSelectedWeek(undefined, OPTS), THIS)
  assert.equal(resolveSelectedWeek('2026-07-14', OPTS), THIS) // 화요일(비월요일)
  assert.equal(resolveSelectedWeek('garbage', OPTS), THIS)
})

test('clampToWindow: 옵션 밖 → 이번주', () => {
  assert.equal(clampToWindow('2026-01-05', OPTS), THIS)
  assert.equal(clampToWindow('2026-06-15', OPTS), '2026-06-15')
})

test('tabEffectiveWeek: org는 무제한 그대로', () => {
  assert.equal(tabEffectiveWeek('org', '2026-01-05', OPTS), '2026-01-05')
})

test('tabEffectiveWeek: mine/team은 윈도우 밖이면 이번주로 클램프(picker↔콘텐츠 일치)', () => {
  assert.equal(tabEffectiveWeek('mine', '2026-01-05', OPTS), THIS)
  assert.equal(tabEffectiveWeek('team', '2026-01-05', OPTS), THIS)
  assert.equal(tabEffectiveWeek('mine', '2026-06-15', OPTS), '2026-06-15') // 윈도우 내는 유지
})
