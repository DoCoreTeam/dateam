/**
 * 다른 탭의 녹음 가드.
 *
 * 사용자 지적(2026-10-21): 녹음하며 다른 기록을 보려고 새 탭을 열었는데, 새 탭은 녹음 중인 줄 몰랐고
 * 거기서 녹음을 또 시작할 수 있었다. 지키는 것: 다른 탭 녹음을 알고, 끊긴 탭은 잊고, 시작을 막는다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STALE_MS, activeRemote, applyTabMessage, parseTabMessage, remoteElapsedSec, type RemoteRecording,
} from './recording-tabs.ts'

const live = (over: Partial<RemoteRecording> = {}) => ({
  type: 'live' as const, tabId: 'A', noteId: 'n1', title: '충남 미팅', href: '/crm/meetings/m1',
  state: 'recording' as const, elapsedSec: 60, at: 1_000_000, ...over,
})

test('다른 탭의 녹음 소식을 받으면 지금 녹음 중인 탭으로 본다', () => {
  const t = applyTabMessage(new Map(), live(), 'B')
  const r = activeRemote(t, 1_000_000 + 1_000)
  assert.equal(r?.title, '충남 미팅')
})

test('내 탭이 보낸 소식은 표에 안 넣는다', () => {
  assert.equal(applyTabMessage(new Map(), live({ tabId: 'B' }), 'B').size, 0)
})

test('끝났다는 소식이나 끊긴 탭은 잊는다 — 닫힌 탭 때문에 영영 막히면 안 된다', () => {
  const t = applyTabMessage(new Map(), live(), 'B')
  assert.equal(applyTabMessage(t, { type: 'gone', tabId: 'A' }, 'B').size, 0)
  assert.equal(activeRemote(t, 1_000_000 + STALE_MS + 1), null)
})

test('경과 초는 녹음 중일 때만 흐른다', () => {
  assert.equal(remoteElapsedSec(live(), 1_000_000 + 5_400), 65)
  assert.equal(remoteElapsedSec(live({ state: 'paused' }), 1_000_000 + 5_400), 60)
})

test('모양이 틀린 소식은 버린다', () => {
  assert.equal(parseTabMessage(null), null)
  assert.equal(parseTabMessage({ type: 'live', tabId: 'A' }), null)
  assert.equal(parseTabMessage({ ...live(), state: 'idle' }), null)
  assert.deepEqual(parseTabMessage({ type: 'ask', tabId: 'A' }), { type: 'ask', tabId: 'A' })
})

test('녹음 세션이 다른 탭 녹음이 있으면 시작하지 않고, 화면이 다른 탭이라고 말한다', () => {
  const ctx = readFileSync('lib/meeting/recording-context.tsx', 'utf8')
  const start = ctx.slice(ctx.indexOf('const start = useCallback'), ctx.indexOf('const stop = useCallback'))
  assert.match(start, /if \(remote\) return/)
  assert.match(ctx, /if \(s\.remote\) return \{[^}]*elsewhere: true \}/)
  const panel = readFileSync('components/meeting/RecordingPanel.tsx', 'utf8')
  assert.match(panel, /busyWithOther\.elsewhere/)
  const bar = readFileSync('components/meeting/RecordingBar.tsx', 'utf8')
  assert.match(bar, /<RemoteBar remote=\{rec\.remote\} \/>/)
})
