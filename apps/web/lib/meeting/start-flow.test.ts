/**
 * 회의 시작 한 길, 가드
 *
 * 사용자 지시 2026-10-26: 「녹음 시작」은 회의 시작과 똑같이 회의와 노트를 만들고,
 * 메모 편집기가 보이는 작업대를 열고, 녹음이 돌고 있어야 한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runStartFlow, startHref, START_MESSAGES, AUTO_RECORD_PARAM } from './start-flow.ts'
import { beginRecording, type BeginOutcome } from './begin-recording.ts'
import { ServerUnreachableError } from '../offline/reachable.ts'
import type { StartMeetingInput } from '../crm/ui/start-meeting.ts'

const fixedNow = new Date('2026-10-26T01:30:00Z')

test('★ 녹음 입구는 메모 편집기와 자동 녹음 표지를 단 주소로 간다', () => {
  assert.equal(AUTO_RECORD_PARAM, 'rec')
  assert.equal(startHref('crm', 'm1', 'record'), '/crm/meetings/m1?wb=memo&rec=1')
  assert.equal(startHref('notes', 'n1', 'record'), '/meeting-notes/n1?wb=memo&rec=1')
})

test('쓰기는 표지 없이 메모, 붙여넣기는 받아 적기 탭', () => {
  assert.equal(startHref('crm', 'm1', 'write'), '/crm/meetings/m1?wb=memo')
  assert.equal(startHref('crm', 'm1', 'paste'), '/crm/meetings/m1?wb=transcript')
  assert.equal(startHref('notes', 'n1', 'write'), '/meeting-notes/n1?wb=memo')
  assert.equal(startHref('notes', 'n1', 'paste'), '/meeting-notes/n1?wb=transcript')
})

test('★ 딜, 회사, 날짜가 만들기 요청 본문으로 그대로 넘어간다', async () => {
  const realFetch = globalThis.fetch
  let sent: Record<string, unknown> | null = null
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ id: 'm9', noteId: 'n9' }), { status: 200 })
  }) as typeof fetch
  try {
    const out = await runStartFlow({ entry: 'record', dealId: 'd1', companyId: 'c1', dateKey: '2026-10-20', now: fixedNow })
    assert.deepEqual(out, { kind: 'navigate', href: '/crm/meetings/m9?wb=memo&rec=1', noteId: 'n9' })
    assert.equal(sent!.dealId, 'd1')
    assert.equal(sent!.companyId, 'c1')
    assert.equal(sent!.startedAt, '2026-10-20T09:00:00+09:00')
    assert.equal(sent!.withNote, true)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('쓰기 입구도 딜과 회사를 넘기고 서버에만 만든다', async () => {
  let got: StartMeetingInput | null = null
  const out = await runStartFlow(
    { entry: 'write', dealId: 'd2', companyId: 'c2' },
    {
      create: async (i) => { got = i; return { id: 'm2', noteId: 'n2' } },
      begin: async () => { throw new Error('녹음 길을 타면 안 된다') },
    },
  )
  assert.deepEqual(out, { kind: 'navigate', href: '/crm/meetings/m2?wb=memo', noteId: 'n2' })
  assert.equal(got!.dealId, 'd2')
  assert.equal(got!.companyId, 'c2')
})

test('★ 오프라인 녹음은 기기 회의로 돌아온다', async () => {
  const pending: string[] = []
  const begin = (i: StartMeetingInput): Promise<BeginOutcome> => beginRecording(i, {
    create: async () => { throw new ServerUnreachableError() },
    remember: (m) => { pending.push(m.localId); return true },
    makeId: () => 'local_1',
    canKeepAudio: () => true,
    now: fixedNow,
  })
  const out = await runStartFlow({ entry: 'record' }, { begin })
  assert.equal(out.kind, 'local')
  assert.equal(out.kind === 'local' && out.localId, 'local_1')
  assert.deepEqual(pending, ['local_1'])
})

test('★ 오프라인 쓰기는 그 말을 던지고 기기에 빈 회의를 남기지 않는다', async () => {
  let beginCalls = 0
  for (const entry of ['write', 'paste'] as const) {
    await assert.rejects(
      runStartFlow({ entry }, {
        create: async () => { throw new ServerUnreachableError() },
        begin: async () => { beginCalls += 1; return { kind: 'local', localId: 'x', title: 't', startedAt: 's' } },
      }),
      { message: START_MESSAGES.offlineCannotWrite },
    )
  }
  assert.equal(beginCalls, 0)
})

test('서버가 거절한 사유는 그대로 올린다', async () => {
  await assert.rejects(
    runStartFlow({ entry: 'record' }, { begin: async () => { throw new Error('이 딜에 접근할 수 없습니다') } }),
    { message: '이 딜에 접근할 수 없습니다' },
  )
  await assert.rejects(
    runStartFlow({ entry: 'write' }, { create: async () => { throw new Error('권한이 없습니다') } }),
    { message: '권한이 없습니다' },
  )
})

test('회의노트 입구: 성공하면 노트 작업대, 실패하면 그 사유나 기본 말', async () => {
  const ok = await runStartFlow({ entry: 'record', target: 'notes' }, { startNote: async () => ({ ok: true, id: 'n5' }) })
  assert.deepEqual(ok, { kind: 'navigate', href: '/meeting-notes/n5?wb=memo&rec=1', noteId: 'n5' })

  await assert.rejects(
    runStartFlow({ entry: 'record', target: 'notes' }, { startNote: async () => ({ ok: false, error: '로그인이 필요합니다' }) }),
    { message: '로그인이 필요합니다' },
  )
  await assert.rejects(
    runStartFlow({ entry: 'record', target: 'notes' }, { startNote: async () => { throw new Error('Failed to fetch') } }),
    { message: START_MESSAGES.notesFailed },
  )
})
