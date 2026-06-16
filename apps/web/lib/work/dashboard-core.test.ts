import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekStartOf, weeklyTrend, statusRollup } from './dashboard-core.ts'

test('weekStartOf: 월요일 시작', () => {
  assert.equal(weekStartOf('2026-06-16'), '2026-06-15') // 화 → 월(15)
  assert.equal(weekStartOf('2026-06-15'), '2026-06-15') // 월 → 그대로
  assert.equal(weekStartOf('2026-06-21'), '2026-06-15') // 일 → 같은주 월
})

test('weeklyTrend: N주 버킷 + 해당 주 카운트', () => {
  const r = weeklyTrend(['2026-06-15', '2026-06-16', '2026-06-08'], '2026-06-16', 4)
  assert.equal(r.length, 4)
  assert.equal(r[r.length - 1].weekStart, '2026-06-15') // 최신주
  assert.equal(r[r.length - 1].count, 2)                // 15·16
  assert.equal(r[r.length - 2].count, 1)                // 08
})

test('weeklyTrend: 범위 밖 날짜는 무시', () => {
  const r = weeklyTrend(['2020-01-01'], '2026-06-16', 4)
  assert.equal(r.reduce((s, x) => s + x.count, 0), 0)
})

test('statusRollup: 타입 총계', () => {
  const r = statusRollup(['done', 'done', 'doing', 'blocker'])
  assert.equal(r.done, 2); assert.equal(r.doing, 1); assert.equal(r.blocker, 1); assert.equal(r.planned, 0)
})
