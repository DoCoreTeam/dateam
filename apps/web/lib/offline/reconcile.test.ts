/**
 * 기기가 만든 회의가 서버로 건너간다 — 가드
 *
 * 여기서 지키는 것은 **잃지 않는 것**이다. 건너다 실패하는 경우가 실패가 아니라,
 * 실패한 뒤에 **기기에서 지워 버리는 것**이 잃는 것이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcilePendingMeetings } from './reconcile.ts'
import type { PendingMeeting } from './local-meeting.ts'
import {
  RECORDING_LEASE_KEY, LEASE_TTL_MS, writeRecordingLease, clearRecordingLease, liveLeasedNoteIds,
} from './recording-lease.ts'

const meeting = (localId: string, over: Partial<PendingMeeting> = {}): PendingMeeting => ({
  localId,
  title: '9/30 미팅',
  startedAt: '2026-09-30T11:00:00+09:00',
  dealId: null,
  companyId: null,
  savedAt: Date.parse('2026-09-30T02:00:00Z'),
  ...over,
})

function harness(rows: PendingMeeting[], over: Partial<Parameters<typeof reconcilePendingMeetings>[0]> = {}) {
  const forgot: string[] = []
  const rekeyed: [string, string][] = []
  const created: { localId: string | null; input: unknown }[] = []
  const marked: [string, string][] = []
  const remembered: [string, string][] = []
  let list = [...rows]
  return {
    forgot, rekeyed, created, marked, remembered,
    deps: {
      list: () => list,
      create: async (input: unknown) => { created.push({ localId: null, input }); return { id: 'm', noteId: 'note_real' } },
      markCreated: (localId: string, noteId: string) => {
        marked.push([localId, noteId])
        list = list.map((m) => (m.localId === localId ? { ...m, serverNoteId: noteId } : m))
        return true
      },
      forget: (localId: string) => { forgot.push(localId) },
      rekey: async (from: string, to: string) => { rekeyed.push([from, to]); return 1 },
      isOnline: () => true,
      leased: () => [] as string[],
      serverIdFor: (_localId: string) => null as string | null,
      remember: (localId: string, noteId: string) => { remembered.push([localId, noteId]) },
      ...over,
    },
  }
}

test('★ 회의를 만들고 구간을 그 밑으로 옮긴 다음에야 대기 목록에서 지운다', async () => {
  const h = harness([meeting('local_a')])
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(r.moved, 1)
  assert.deepEqual(h.rekeyed, [['local_a', 'note_real']])
  assert.deepEqual(h.forgot, ['local_a'])
})

test('★ 시작 시각이 녹음을 켠 순간 그대로 간다 — 올린 시각으로 만들면 오전 회의가 오후가 된다', async () => {
  const h = harness([meeting('local_a')])
  await reconcilePendingMeetings(h.deps)
  const input = h.created[0].input as { now: Date }
  assert.equal(input.now.toISOString(), new Date('2026-09-30T11:00:00+09:00').toISOString())
})

test('★ 딜·회사가 그대로 물려간다 — 연결된 뒤에 다시 고르게 하지 않는다', async () => {
  const h = harness([meeting('local_a', { dealId: 'd1', companyId: 'c1' })])
  await reconcilePendingMeetings(h.deps)
  const input = h.created[0].input as { dealId: string; companyId: string }
  assert.equal(input.dealId, 'd1')
  assert.equal(input.companyId, 'c1')
})

test('★ 회의 만들기가 실패하면 대기 목록에서 안 지운다 — 지우면 그 회의는 영영 안 올라간다', async () => {
  const h = harness([meeting('local_a')], {
    create: async () => { throw new Error('서버가 안 받아요') },
  })
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(r.moved, 0)
  assert.deepEqual(r.failed.map((f) => f.localId), ['local_a'])
  assert.deepEqual(h.forgot, [], '실패했는데 지웠다')
})

test('★ 옮기기가 실패해도 지우지 않고, 다음 판은 회의를 또 만들지 않는다', async () => {
  let attempt = 0
  const h = harness([meeting('local_a')], {
    rekey: async () => { attempt += 1; if (attempt === 1) throw new Error('옮기지 못했어요'); return 1 },
  })
  const first = await reconcilePendingMeetings(h.deps)
  assert.equal(first.moved, 0)
  assert.deepEqual(h.forgot, [])
  assert.deepEqual(h.marked, [['local_a', 'note_real']], '서버 id 를 안 적어 뒀다')

  const second = await reconcilePendingMeetings(h.deps)
  assert.equal(second.moved, 1)
  assert.equal(h.created.length, 1, '같은 회의를 두 번 만들었다 — 딜에 기록이 두 벌 붙는다')
})

test('★ 녹음 중인 회의는 안 건넌다 — 건너는 동안 쌓이는 구간이 고아가 된다', async () => {
  const h = harness([meeting('local_live'), meeting('local_done')], { activeNoteId: 'local_live' })
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(r.deferred, 1)
  assert.equal(r.moved, 1)
  assert.deepEqual(h.forgot, ['local_done'])
  assert.deepEqual(h.rekeyed, [['local_done', 'note_real']])
})

test('★ 하나가 실패해도 나머지는 계속 건넌다', async () => {
  let n = 0
  const h = harness([meeting('local_a'), meeting('local_b')], {
    create: async () => { n += 1; if (n === 1) throw new Error('첫 회의 실패'); return { id: 'm', noteId: 'note_real' } },
  })
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(r.moved, 1)
  assert.equal(r.failed.length, 1)
  assert.deepEqual(h.forgot, ['local_b'])
})

test('끊겨 있으면 아무것도 안 한다 — 실패로 세지 않는다', async () => {
  const h = harness([meeting('local_a')], { isOnline: () => false })
  const r = await reconcilePendingMeetings(h.deps)
  assert.deepEqual(r, { moved: 0, failed: [], deferred: 0, skipped: true })
  assert.deepEqual(h.created, [])
})

test('대기 회의가 없으면 서버를 안 부른다', async () => {
  const h = harness([])
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(r.skipped, false)
  assert.deepEqual(h.created, [])
})

test('★ 다른 탭이 녹음 중인 회의도 안 건넌다 — 이 탭 target 은 비어 있다 (2026-10-26 실측)', async () => {
  const h = harness([meeting('local_other')], { activeNoteId: null, activeNoteIds: [null, 'local_other'] })
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(r.deferred, 1)
  assert.equal(h.created.length, 0, '다른 탭이 녹음 중인 회의를 서버에 만들었다')
  assert.deepEqual(h.forgot, [])
})

test('★ 녹음 임대가 살아 있는 회의는 activeNoteIds 에 없어도 미룬다', async () => {
  const h = harness([meeting('local_leased')], { leased: () => ['local_leased'] })
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(r.deferred, 1)
  assert.equal(h.created.length, 0)
})

/** localStorage 흉내 — 녹음 임대는 탭끼리 나누는 칸이라 저장소 하나를 둘이 같이 본다 */
function memStore(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
}

test('★ 기한 지난 녹음 임대는 무시하고 건넌다 — 닫힌 탭이 회의를 영영 붙잡지 않는다', async () => {
  const store = memStore()
  const t0 = 1_000_000
  writeRecordingLease('local_stale', t0, store)
  const later = t0 + LEASE_TTL_MS + 1
  const h = harness([meeting('local_stale')], { leased: () => liveLeasedNoteIds(later, store) })
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(r.deferred, 0)
  assert.equal(r.moved, 1)
})

test('녹음 임대: 쓰면 살아 있고, 놓으면 사라지고, 기한이 지나면 빠진다', () => {
  const store = memStore()
  writeRecordingLease('local_a', 100, store)
  writeRecordingLease('local_b', 100, store)
  assert.deepEqual(liveLeasedNoteIds(100 + LEASE_TTL_MS, store).sort(), ['local_a', 'local_b'])
  clearRecordingLease('local_a', store)
  assert.deepEqual(liveLeasedNoteIds(200, store), ['local_b'])
  assert.deepEqual(liveLeasedNoteIds(100 + LEASE_TTL_MS + 1, store), [])
  assert.ok(store.getItem(RECORDING_LEASE_KEY))
})

test('녹음 임대: 저장소가 없거나 망가지거나 던져도 죽지 않는다', () => {
  const broken = memStore()
  broken.setItem(RECORDING_LEASE_KEY, '{망가짐')
  assert.deepEqual(liveLeasedNoteIds(0, broken), [])
  broken.setItem(RECORDING_LEASE_KEY, '[1,2]')
  assert.deepEqual(liveLeasedNoteIds(0, broken), [])
  const throwing = { ...memStore(), getItem: () => { throw new Error('막힘') }, setItem: () => { throw new Error('막힘') } } as Storage
  assert.deepEqual(liveLeasedNoteIds(0, throwing), [])
  assert.doesNotThrow(() => writeRecordingLease('local_a', 0, throwing))
  assert.doesNotThrow(() => clearRecordingLease('local_a', throwing))
})

test('★ 회의를 만들면 지역 id 와 서버 id 짝을 대기 목록과 따로 남긴다', async () => {
  const h = harness([meeting('local_a')])
  await reconcilePendingMeetings(h.deps)
  assert.deepEqual(h.remembered, [['local_a', 'note_real']])
})

test('★ 이미 짝이 있는 지역 id 는 회의를 다시 만들지 않고 그 서버 id 로 옮긴다', async () => {
  const h = harness([meeting('local_a')], { serverIdFor: (id: string) => (id === 'local_a' ? 'note_prev' : null) })
  const r = await reconcilePendingMeetings(h.deps)
  assert.equal(h.created.length, 0, '짝이 있는데 회의를 또 만들었다')
  assert.deepEqual(h.rekeyed, [['local_a', 'note_prev']])
  assert.equal(r.moved, 1)
})
