/**
 * 녹음 구간이 어디로 가나, 가드
 *
 * 실측 2026-10-26: 녹음 중에 회의가 서버로 건너간 뒤에도 녹음기는 `local_…` 주소로 올렸고
 * 구간 6개가 전부 「회의노트를 찾을 수 없습니다」로 실패한 채 고아가 됐다.
 * 지역 id 는 **올리지 않고 기기에 둔다.** 짝이 생겼으면 **서버 id 로 보관하고 올린다.**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePartDestination } from './part-destination.ts'

test('★ 서버 id 는 그대로 올린다', () => {
  assert.deepEqual(resolvePartDestination('note_real', { serverIdFor: () => null }), { noteId: 'note_real', upload: true })
})

test('★ 지역 id 이고 짝이 없으면 올리지 않고 기기에만 둔다 (404 를 치지 않는다)', () => {
  assert.deepEqual(resolvePartDestination('local_a', { serverIdFor: () => null }), { noteId: 'local_a', upload: false })
})

test('★ 지역 id 이고 짝이 있으면 서버 id 로 보관하고 올린다', () => {
  const r = resolvePartDestination('local_a', { serverIdFor: (id) => (id === 'local_a' ? 'note_real' : null) })
  assert.deepEqual(r, { noteId: 'note_real', upload: true })
})

test('지역 판정은 주입할 수 있고 기본은 local_ 접두어다', () => {
  assert.deepEqual(resolvePartDestination('x1', { isLocal: () => true, serverIdFor: () => null }), { noteId: 'x1', upload: false })
  assert.deepEqual(resolvePartDestination('local_b', { serverIdFor: () => null }).upload, false)
})
