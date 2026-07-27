import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOrphanDailyEvent } from './orphan-event.ts'

const ME = 'user-me'
const live = new Set(['log-live'])

test('원본 일일업무가 삭제된 본인 자동생성 일정 → 고아(제외)', () => {
  assert.equal(
    isOrphanDailyEvent({ user_id: ME, link_kind: 'daily', link_id: 'log-gone' }, ME, live),
    true,
  )
})

test('원본이 살아있으면 고아 아님', () => {
  assert.equal(
    isOrphanDailyEvent({ user_id: ME, link_kind: 'daily', link_id: 'log-live' }, ME, live),
    false,
  )
})

test('수동 일정(link_id 없음)은 대상 아님', () => {
  assert.equal(
    isOrphanDailyEvent({ user_id: ME, link_kind: null, link_id: null }, ME, live),
    false,
  )
})

test('meeting 등 다른 link_kind는 대상 아님', () => {
  assert.equal(
    isOrphanDailyEvent({ user_id: ME, link_kind: 'meeting', link_id: 'anything' }, ME, live),
    false,
  )
})

test('타인(조직계층) 일정은 검사 제외 — RLS 오탐 방지', () => {
  // 타인 일정은 링크 로그를 못 읽어 liveLogIds에 없더라도 고아로 처리하면 안 됨.
  assert.equal(
    isOrphanDailyEvent({ user_id: 'user-other', link_kind: 'daily', link_id: 'log-gone' }, ME, live),
    false,
  )
})
