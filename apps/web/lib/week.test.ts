import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prevWeekStart } from './week.ts'

test('prevWeekStart: 일반 주 -7일', () => {
  assert.equal(prevWeekStart('2026-06-15'), '2026-06-08')
})

test('prevWeekStart: 월 경계', () => {
  assert.equal(prevWeekStart('2026-06-01'), '2026-05-25')
})

test('prevWeekStart: 연말 경계', () => {
  assert.equal(prevWeekStart('2026-01-05'), '2025-12-29')
})

test('prevWeekStart: 윤년 2월', () => {
  assert.equal(prevWeekStart('2024-03-04'), '2024-02-26')
})
