import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupByMeetingDate } from './group-by-date.ts'

test('같은 날짜는 한 그룹으로 묶인다', () => {
  const items = [
    { id: 'a', meeting_at: '2026-06-23T03:20:00' },
    { id: 'b', meeting_at: '2026-06-23T22:00:00' },
  ]
  const groups = groupByMeetingDate(items)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].dateKey, '2026-06-23')
  assert.equal(groups[0].items.length, 2)
})

test('날짜 내림차순 정렬(최근 먼저)', () => {
  const items = [
    { id: 'old', meeting_at: '2026-06-20T10:00:00' },
    { id: 'new', meeting_at: '2026-06-24T10:00:00' },
  ]
  const groups = groupByMeetingDate(items)
  assert.equal(groups[0].dateKey, '2026-06-24')
  assert.equal(groups[1].dateKey, '2026-06-20')
})

test('일시 미지정(null)은 별도 그룹이며 항상 맨 끝', () => {
  const items = [
    { id: 'none', meeting_at: null },
    { id: 'dated', meeting_at: '2026-06-23T10:00:00' },
  ]
  const groups = groupByMeetingDate(items)
  assert.equal(groups[groups.length - 1].dateKey, 'unscheduled')
  assert.equal(groups[groups.length - 1].label, '일시 미지정')
})

test('잘못된 날짜 문자열은 미지정으로 분류', () => {
  const groups = groupByMeetingDate([{ id: 'bad', meeting_at: 'not-a-date' }])
  assert.equal(groups[0].dateKey, 'unscheduled')
})

test('빈 입력은 빈 배열', () => {
  assert.deepEqual(groupByMeetingDate([]), [])
})
