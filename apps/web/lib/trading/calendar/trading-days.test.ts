import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tradingDaysBetween, nextDay, coversRange, type OpenDay } from './trading-days.ts'

/** 2026-09-25(금)부터 2026-10-09(금)까지. 주말 휴장 + 10-05~10-07 추석 가정 */
const CLOSED = new Set(['2026-09-26', '2026-09-27', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-10', '2026-10-11'])
const days: OpenDay[] = []
for (let d = new Date(Date.UTC(2026, 8, 25)); d <= new Date(Date.UTC(2026, 9, 12)); d.setUTCDate(d.getUTCDate() + 1)) {
  const date = d.toISOString().slice(0, 10)
  days.push({ date, open: !CLOSED.has(date) })
}

test('다음 날을 넘어간다 — 달이 바뀌어도', () => {
  assert.equal(nextDay('2026-09-30'), '2026-10-01')
  assert.equal(nextDay('2026-12-31'), '2027-01-01')
})

test('오늘은 안 세고 목표일은 센다', () => {
  // 09-25 다음 개장일은 09-28(월). 09-28 까지면 1
  assert.equal(tradingDaysBetween(days, '2026-09-25', '2026-09-28'), 1)
})

test('목표일이 오늘이거나 과거면 0 이다', () => {
  assert.equal(tradingDaysBetween(days, '2026-09-25', '2026-09-25'), 0)
  assert.equal(tradingDaysBetween(days, '2026-09-25', '2026-09-24'), 0)
})

test('★ 주말만 빼면 틀린다 — 추석 사흘이 빠져야 한다', () => {
  // 09-25 → 10-09: 달력상 14일. 주말 4일(26·27·03·04) + 추석 3일(05·06·07) 빠짐
  const counted = tradingDaysBetween(days, '2026-09-25', '2026-10-09')
  assert.equal(counted, 7, `개장일이 ${counted}일로 나왔다`)
  // 주말만 뺐다면 10일이었을 것이다. 그 차이가 교체를 사흘 늦춘다
  assert.notEqual(counted, 10)
})

test('★ 표가 구간을 못 덮으면 null 이다 — 덮은 데까지 세면 너무 일찍 교체한다', () => {
  assert.equal(tradingDaysBetween(days, '2026-09-25', '2026-11-30'), null)
  assert.equal(tradingDaysBetween([], '2026-09-25', '2026-09-28'), null)
})

test('구간을 덮는지 미리 물을 수 있다', () => {
  assert.equal(coversRange(days, '2026-09-25', '2026-10-09'), true)
  assert.equal(coversRange(days, '2026-09-25', '2026-11-30'), false)
  assert.equal(coversRange([], '2026-09-25', '2026-09-25'), true)
})
