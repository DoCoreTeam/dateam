import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildActiveThread, type ThreadMsg } from './thread.ts'

// created_at asc 정렬 입력을 만들기 위한 헬퍼 (t = 정수 시퀀스)
function msg(id: string, parent: string | null, t: number): ThreadMsg {
  return { id, parent_message_id: parent, created_at: new Date(2026, 0, 1, 0, 0, t).toISOString() }
}
const ids = (arr: ThreadMsg[]) => arr.map((m) => m.id)

test('① 편집 없음 → 원본 그대로', () => {
  const sorted = [msg('u1', null, 1), msg('a1', null, 2), msg('u2', null, 3), msg('a2', null, 4)]
  assert.deepEqual(ids(buildActiveThread(sorted)), ['u1', 'a1', 'u2', 'a2'])
})

test('② 중간 user 편집 → 절단+대체 (u1 a1 u2 a2 u3 a3 + u2′ → u1 a1 u2′)', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u3', null, 5),
    msg('a3', null, 6),
    msg('u2p', 'u2', 7), // u2 편집 (parent=u2)
  ]
  assert.deepEqual(ids(buildActiveThread(sorted)), ['u1', 'a1', 'u2p'])
})

test('③ 편집의 편집 (parent=직전 편집 u2′)', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u3', null, 5),
    msg('a3', null, 6),
    msg('u2p', 'u2', 7),
    msg('u2pp', 'u2p', 8), // 편집의 편집 — parent는 화면의 활성 메시지 u2p
  ]
  assert.deepEqual(ids(buildActiveThread(sorted)), ['u1', 'a1', 'u2pp'])
})

test('④ 첫 메시지 편집 → 전체 대체', () => {
  const sorted = [msg('u1', null, 1), msg('a1', null, 2), msg('u1p', 'u1', 3)]
  assert.deepEqual(ids(buildActiveThread(sorted)), ['u1p'])
})

test('⑤ 비활성 꼬리 메시지를 parent로 갖는 고아 편집 → skip', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u2p', 'u2', 5), // 여기서 a2가 비활성 꼬리로 밀려남
    msg('orphan', 'a2', 6), // 이미 스레드에서 사라진 a2를 parent로 → skip
  ]
  assert.deepEqual(ids(buildActiveThread(sorted)), ['u1', 'a1', 'u2p'])
})

test('⑥ 편집 후 이어진 신규 턴 포함 순서 보존', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u2p', 'u2', 5),
    msg('a2p', null, 6), // 편집 후 새 assistant
    msg('u3', null, 7), // 새 user 턴
    msg('a3', null, 8),
  ]
  assert.deepEqual(ids(buildActiveThread(sorted)), ['u1', 'a1', 'u2p', 'a2p', 'u3', 'a3'])
})

test('제네릭 T의 부가 필드(role·content) 승계 확인', () => {
  type Rich = ThreadMsg & { role: string; content: string }
  const sorted: Rich[] = [
    { id: 'u1', parent_message_id: null, created_at: 't1', role: 'user', content: 'hi' },
    { id: 'u1p', parent_message_id: 'u1', created_at: 't2', role: 'user', content: 'edited' },
  ]
  const out = buildActiveThread(sorted)
  assert.equal(out.length, 1)
  assert.equal(out[0].content, 'edited')
  assert.equal(out[0].role, 'user')
})
