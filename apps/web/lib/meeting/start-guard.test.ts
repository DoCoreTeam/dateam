/**
 * 녹음 중에는 새 회의를 만들지 않는다, 가드
 *
 * 실측 2026-10-26: 지역 녹음을 켠 뒤 시작 단추가 다시 열려 있었고, 16초 뒤 다시 누르자
 * 서버 회의가 하나 더 생기고 화면이 그리로 옮겨 갔다. 녹음기는 그대로 지역 id 로 녹음해
 * 사용자가 쓴 회의에는 구간이 0개였다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeRecordingBlock, startUnlessRecording, startBlockedMessage, type StartGuardInput } from './start-guard.ts'

const idle: StartGuardInput = { target: null, state: 'idle', remote: null }
const local = { noteId: 'local_a', title: '10/26 미팅', href: '/crm/today' }

test('★ 이 탭이 녹음 중(멈춤, 마무리 포함)이면 막는다', () => {
  for (const state of ['recording', 'paused', 'stopping'] as const) {
    assert.deepEqual(activeRecordingBlock({ target: local, state, remote: null }), { ...local, elsewhere: false })
  }
})

test('★ 다른 탭이 녹음 중이면 막는다', () => {
  const remote = { noteId: 'note_x', title: '다른 탭 회의', href: '/crm/meetings/x' }
  assert.deepEqual(activeRecordingBlock({ ...idle, remote }), { ...remote, elsewhere: true })
})

test('녹음이 없거나 끝났으면 막지 않는다', () => {
  assert.equal(activeRecordingBlock(idle), null)
  assert.equal(activeRecordingBlock({ target: local, state: 'idle', remote: null }), null)
  assert.equal(activeRecordingBlock({ target: local, state: 'error', remote: null }), null)
})

test('★ 막히면 회의를 만드는 함수를 부르지 않는다', async () => {
  let calls = 0
  const out = await startUnlessRecording({ target: local, state: 'recording', remote: null }, async () => { calls += 1; return 'made' })
  assert.equal(calls, 0, '녹음 중인데 회의를 하나 더 만들었다')
  assert.equal(out.blocked?.noteId, 'local_a')
})

test('막히지 않으면 그대로 부른다', async () => {
  const out = await startUnlessRecording(idle, async () => 'made')
  assert.equal(out.blocked, null)
  assert.equal(out.result, 'made')
})

test('안내는 지금 녹음 중인 회의 이름을 말하고 전각 대시를 안 쓴다', () => {
  const here = startBlockedMessage({ ...local, elsewhere: false })
  const there = startBlockedMessage({ ...local, elsewhere: true })
  assert.ok(here.includes('10/26 미팅'))
  assert.ok(there.includes('다른 탭'))
  assert.ok(!here.includes('\u2014') && !there.includes('\u2014'))
})
