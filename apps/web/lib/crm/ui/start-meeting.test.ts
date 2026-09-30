import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  defaultMeetingTitle, nowKstWall, buildStartBody, meetingHref, startMeeting,
} from './start-meeting.ts'
import { SERVER_UNREACHABLE_MESSAGE } from '../../offline/reachable.ts'

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


/* ── 창구가 실패할 때 사람이 읽는 말 (v0.10.727) ──────────────
 *
 * **왜 (실측 2026-09-30)**: 사용자가 CRM 첫 화면에서 「녹음 시작」을 눌렀고 화면에 뜬 말이
 * **「Failed to fetch」** 였다. 서버가 내려가 있어 요청이 아예 못 나간 것인데, 그 말로는
 * 무엇이 잘못됐는지도 무엇을 하면 되는지도 알 수 없다. 영어인 것은 그 다음 문제다.
 *
 * 실패에는 두 종류가 있고 **한 말로 뭉개면 안 된다** —
 *   ① 서버가 아예 답을 안 했다 (창구가 안 열린다)
 *   ② 서버가 답했는데 거절했다 (권한·검증 — 그 말은 서버가 더 잘 안다)
 */

/** 한 번 쓰고 되돌리는 창구 바꿔치기 — 전역을 건드리므로 반드시 되돌린다 */
async function withFetch<T>(impl: typeof globalThis.fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

const jsonResponse = (status: number, body: unknown): Response =>
  ({ ok: status < 400, status, json: async () => body }) as Response

test('★ 서버에 못 닿으면 「Failed to fetch」가 아니라 사람이 읽는 말이 간다', async () => {
  const dead: typeof globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await withFetch(dead, async () => {
    const err = await startMeeting().then(() => null, (e: unknown) => e as Error)
    assert.ok(err instanceof Error, '실패를 안 던진다 — 눌렀는데 아무 일도 안 일어난다')
    assert.ok(!err.message.includes('Failed to fetch'), '브라우저 원문이 그대로 샌다')
    assert.equal(err.message, SERVER_UNREACHABLE_MESSAGE)
  })
})

test('★ 서버가 답했는데 거절한 것은 서버의 말을 그대로 전한다 — 두 실패를 뭉개지 않는다', async () => {
  const refuses: typeof globalThis.fetch = async () =>
    jsonResponse(403, { error: { message: '이 딜에는 미팅을 남길 수 없어요.' } })
  await withFetch(refuses, async () => {
    const err = await startMeeting().then(() => null, (e: unknown) => e as Error)
    assert.equal(err?.message, '이 딜에는 미팅을 남길 수 없어요.')
    assert.notEqual(err?.message, SERVER_UNREACHABLE_MESSAGE, '거절을 「못 닿았다」로 바꿔 말한다')
  })
})

test('서버가 답했지만 본문이 없으면 그때의 기본 말을 쓴다 — 이것도 「못 닿았다」가 아니다', async () => {
  const broken: typeof globalThis.fetch = async () =>
    ({ ok: false, status: 500, json: async () => { throw new Error('not json') } }) as unknown as Response
  await withFetch(broken, async () => {
    const err = await startMeeting().then(() => null, (e: unknown) => e as Error)
    assert.match(err?.message ?? '', /미팅을 만들지 못했습니다/)
    assert.notEqual(err?.message, SERVER_UNREACHABLE_MESSAGE)
  })
})

test('되면 작업대로 갈 id 를 준다', async () => {
  const okFetch: typeof globalThis.fetch = async () =>
    jsonResponse(200, { id: 'm_1', noteId: 'n_1' })
  await withFetch(okFetch, async () => {
    assert.deepEqual(await startMeeting(), { id: 'm_1', noteId: 'n_1' })
  })
})
