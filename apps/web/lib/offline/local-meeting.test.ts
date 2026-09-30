/**
 * 기기가 회의 id 를 먼저 만든다 — 가드
 *
 * **왜 (사용자 지시 2026-09-30)**: *"어떤 상황이든 누락되는게 발생되면 안되는거야 …
 * 오프라인에서도 되게 만들어"*.
 *
 * 지금은 「녹음 시작」이 서버에 회의를 먼저 만들어야 한다. 연결이 없으면 그 한 번을 못 넘어
 * **녹음 자체가 시작되지 않는다.** 소리를 받아 적는 층(`blob-store`)은 이미 오프라인을 견디는데
 * 입구만 못 견딘다.
 *
 * 그래서 id 를 기기가 먼저 만든다. 서버는 연결이 돌아온 뒤 따라온다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCAL_ID_PREFIX, newLocalNoteId, isLocalNoteId,
  addPendingMeeting, listPendingMeetings, removePendingMeeting, expiredPendingMeetings,
  type PendingMeeting,
} from './local-meeting.ts'
import { MAX_KEEP_DAYS } from './blob-store.ts'

/** 브라우저 없이 시험하려고 `localStorage` 모양만 흉내낸다 */
function fakeStore(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, v) },
  } as Storage
}

const T0 = Date.parse('2026-09-30T02:00:00Z')
const meeting = (localId: string, savedAt = T0): PendingMeeting => ({
  localId,
  title: '9/30 미팅',
  startedAt: '2026-09-30T11:00:00+09:00',
  dealId: null,
  companyId: null,
  savedAt,
})

/* ── id ─────────────────────────────────────────────────── */

test('★ 기기가 만든 id 는 서버 id 와 확실히 갈린다 — 섞이면 없는 주소로 올린다', () => {
  const id = newLocalNoteId()
  assert.ok(id.startsWith(LOCAL_ID_PREFIX), id)
  assert.equal(isLocalNoteId(id), true)

  // 이 저장소가 실제로 쓰는 서버 id 두 모양 — 우연히 걸리면 안 된다
  assert.equal(isLocalNoteId('74a604a9-7d91-4072-9848-fe686ae7d03c'), false, 'uuid 를 로컬로 본다')
  assert.equal(isLocalNoteId('cmuccd3yi000djw04psv58m33'), false, 'cuid 를 로컬로 본다')
  assert.equal(isLocalNoteId(''), false)
})

test('★ 두 번 부르면 다른 id 다 — 같으면 두 회의가 한 회의가 된다', () => {
  assert.notEqual(newLocalNoteId(), newLocalNoteId())
})

/* ── 대기 회의 ───────────────────────────────────────────── */

test('★ 시작 시각은 녹음을 켠 순간으로 굳는다 — 연결이 돌아온 시각이면 오전 회의가 오후가 된다', () => {
  const store = fakeStore()
  addPendingMeeting(meeting('local_a'), store)
  const [got] = listPendingMeetings(T0, store)
  assert.equal(got.startedAt, '2026-09-30T11:00:00+09:00')
  assert.equal(got.title, '9/30 미팅')
})

test('넣고 빼기가 맞는다 — 올린 회의는 기기에서 지운다(개인정보)', () => {
  const store = fakeStore()
  addPendingMeeting(meeting('local_a'), store)
  addPendingMeeting(meeting('local_b'), store)
  assert.equal(listPendingMeetings(T0, store).length, 2)

  removePendingMeeting('local_a', store)
  const left = listPendingMeetings(T0, store)
  assert.deepEqual(left.map((m) => m.localId), ['local_b'])
})

test('★ 같은 회의를 두 번 넣지 않는다 — 두 벌이 되면 딜에 붙는 기록도 둘이 된다', () => {
  const store = fakeStore()
  addPendingMeeting(meeting('local_a'), store)
  addPendingMeeting(meeting('local_a'), store)
  assert.equal(listPendingMeetings(T0, store).length, 1)
})

/* ── 개인정보: 기한 ──────────────────────────────────────── */

test('★ 기한이 지난 회의는 대기 목록에서 빠진다 — 노트북에 회의 제목이 영원히 남지 않는다', () => {
  const store = fakeStore()
  const old = T0 - (MAX_KEEP_DAYS + 1) * 86_400_000
  addPendingMeeting(meeting('local_old', old), store)
  addPendingMeeting(meeting('local_new', T0), store)

  assert.deepEqual(listPendingMeetings(T0, store).map((m) => m.localId), ['local_new'])
})

test('★ 기한이 지났다고 말없이 사라지지 않는다 — 무엇을 잃는지 셀 수 있어야 한다', () => {
  const store = fakeStore()
  const old = T0 - (MAX_KEEP_DAYS + 1) * 86_400_000
  addPendingMeeting(meeting('local_old', old), store)
  assert.deepEqual(expiredPendingMeetings(T0, store).map((m) => m.localId), ['local_old'])
})

test('기한은 구간 보관과 같은 값을 쓴다 — 둘이 갈리면 소리는 있는데 회의가 없어진다', () => {
  const store = fakeStore()
  const justInside = T0 - (MAX_KEEP_DAYS * 86_400_000) + 1000
  addPendingMeeting(meeting('local_edge', justInside), store)
  assert.equal(listPendingMeetings(T0, store).length, 1)
})

/* ── 못 쓰는 브라우저 ────────────────────────────────────── */

test('★ 저장할 수 없으면 조용히 성공하지 않는다 — 된 줄 알고 녹음하면 그게 잃는 것이다', () => {
  const broken = {
    getItem: () => { throw new Error('막힘') },
    setItem: () => { throw new Error('막힘') },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage
  assert.equal(addPendingMeeting(meeting('local_a'), broken), false, '실패를 true 로 돌려준다')
  assert.deepEqual(listPendingMeetings(T0, broken), [], '못 읽는데 목록을 지어낸다')
})

test('망가진 내용이 들어 있어도 죽지 않는다 — 한 번 깨지면 영영 못 올린다', () => {
  const store = fakeStore()
  store.setItem('newax.pending-meetings', '{이건 JSON 이 아니다')
  assert.deepEqual(listPendingMeetings(T0, store), [])
  assert.equal(addPendingMeeting(meeting('local_a'), store), true, '깨진 뒤로는 못 쓰게 된다')
  assert.equal(listPendingMeetings(T0, store).length, 1)
})
