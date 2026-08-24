import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  defaultMeetingTitle, nowKstWall, buildStartBody, meetingHref,
} from './start-meeting.ts'

test('제목 기본값은 월/일 미팅 — 앞자리 0을 붙이지 않는다', () => {
  assert.equal(defaultMeetingTitle('2026-08-24'), '8/24 미팅')
  assert.equal(defaultMeetingTitle('2026-01-05'), '1/5 미팅')
  assert.equal(defaultMeetingTitle('2026-12-31'), '12/31 미팅')
})

test('시각 기본값은 지금 이 순간의 KST — 예전 14:00 고정값이 재유입되면 실패한다', () => {
  // 2026-08-24 09:30 KST = 2026-08-24 00:30 UTC
  const at0930 = new Date('2026-08-24T00:30:00Z')
  assert.deepEqual(nowKstWall(at0930), { date: '2026-08-24', time: '09:30' })
})

test('UTC 자정을 넘긴 KST 는 날짜가 하루 앞선다 — 이걸 놓치면 새벽 회의가 전날로 기록된다', () => {
  // 2026-08-24 23:10 KST = 2026-08-24 14:10 UTC
  const late = new Date('2026-08-24T14:10:00Z')
  assert.deepEqual(nowKstWall(late), { date: '2026-08-24', time: '23:10' })

  // 2026-08-25 00:20 KST = 2026-08-24 15:20 UTC — UTC 로는 아직 24일이다
  const justAfterMidnight = new Date('2026-08-24T15:20:00Z')
  assert.deepEqual(nowKstWall(justAfterMidnight), { date: '2026-08-25', time: '00:20' })
})

test('한 자리 시·분에 0을 채운다', () => {
  // 2026-03-02 01:05 KST = 2026-03-01 16:05 UTC
  const early = new Date('2026-03-01T16:05:00Z')
  assert.deepEqual(nowKstWall(early), { date: '2026-03-02', time: '01:05' })
})

test('startedAt 은 반드시 +09:00 앵커 — naive 문자열이면 DB 가 UTC 로 읽어 9시간 어긋난다', () => {
  const body = buildStartBody({ now: new Date('2026-08-24T00:30:00Z') })
  assert.equal(body.startedAt, '2026-08-24T09:30:00+09:00')
  assert.equal(body.title, '8/24 미팅')
})

test('withNote 는 항상 true — 원본 없는 미팅을 만들지 않는다(D5)', () => {
  assert.equal(buildStartBody().withNote, true)
})

test('딜·회사는 물려 오고, 없으면 null 로 보낸다(빈 문자열 금지)', () => {
  const withDeal = buildStartBody({ dealId: 'deal_1' })
  assert.equal(withDeal.dealId, 'deal_1')
  assert.equal(withDeal.companyId, null)

  const withCompany = buildStartBody({ companyId: 'co_1' })
  assert.equal(withCompany.companyId, 'co_1')
  assert.equal(withCompany.dealId, null)

  // 빈 문자열은 "안 골랐다"는 뜻이지 id 가 아니다 — 그대로 보내면 서버가 못 찾는다
  const blank = buildStartBody({ dealId: '', companyId: '' })
  assert.equal(blank.dealId, null)
  assert.equal(blank.companyId, null)
})

test('만든 뒤 갈 곳은 작업대 하나 — 중간 화면(/new)으로 되돌아가지 않는다', () => {
  assert.equal(meetingHref('abc123'), '/crm/meetings/abc123')
  assert.ok(!meetingHref('abc123').includes('/new'))
})
