import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildActiveThread,
  getBranchGroups,
  buildThreadForChoice,
  type ThreadMsg,
} from './thread.ts'

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

// 회귀 가드: buildActiveThread는 멱등이 아니다. 축약본(활성 스레드)을 다시 넣으면 편집 메시지가 소실된다.
// 이래서 서버 getMessages가 이미 활성 스레드를 반환하면 클라는 재적용하면 안 된다(이중적용 버그 재유입 차단).
test('비멱등성: 편집이 포함된 축약본을 재적용하면 편집 메시지가 소실된다', () => {
  const full = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u2p', 'u2', 5), // u2 편집
    msg('a2p', null, 6),
  ]
  const once = buildActiveThread(full)
  assert.deepEqual(ids(once), ['u1', 'a1', 'u2p', 'a2p']) // 1회 = 정상 활성 스레드
  const twice = buildActiveThread(once)
  // 재적용: u2p.parent(u2)가 축약본에 없어 skip → 편집 질문 u2p 소실 (비멱등 — 재적용 금지 근거)
  assert.deepEqual(ids(twice), ['u1', 'a1', 'a2p'])
})

// ── 세션 3 §5-5: getBranchGroups / buildThreadForChoice ──

// mkeys(map) — 그룹 Map을 검증하기 쉬운 순수 객체로.
function groupObj(map: Map<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, v] of map) out[k] = v
  return out
}

test('getBranchGroups: 편집 없으면 빈 Map(그룹 크기1 제외)', () => {
  const sorted = [msg('u1', null, 1), msg('a1', null, 2), msg('u2', null, 3)]
  assert.deepEqual(groupObj(getBranchGroups(sorted)), {})
})

test('getBranchGroups: 단일 편집 그룹 [원본, 편집]', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u2p', 'u2', 5),
  ]
  assert.deepEqual(groupObj(getBranchGroups(sorted)), { u2: ['u2', 'u2p'] })
})

test('getBranchGroups: 편집의 편집(중첩) → 루트 기준 단일 그룹', () => {
  const sorted = [
    msg('u2', null, 1),
    msg('u2p', 'u2', 2),
    msg('u2pp', 'u2p', 3),
  ]
  assert.deepEqual(groupObj(getBranchGroups(sorted)), { u2: ['u2', 'u2p', 'u2pp'] })
})

test('getBranchGroups: 다중 그룹 분리', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('u1p', 'u1', 2),
    msg('u2', null, 3),
    msg('u2p', 'u2', 4),
    msg('u3', null, 5), // 편집 없음 → 미포함
  ]
  assert.deepEqual(groupObj(getBranchGroups(sorted)), {
    u1: ['u1', 'u1p'],
    u2: ['u2', 'u2p'],
  })
})

test('불변식: buildThreadForChoice(sorted, {}) ≡ buildActiveThread(sorted)', () => {
  const scenarios: ThreadMsg[][] = [
    [msg('u1', null, 1), msg('a1', null, 2), msg('u2', null, 3), msg('a2', null, 4)],
    [
      msg('u1', null, 1),
      msg('a1', null, 2),
      msg('u2', null, 3),
      msg('a2', null, 4),
      msg('u3', null, 5),
      msg('a3', null, 6),
      msg('u2p', 'u2', 7),
    ],
    [msg('u1', null, 1), msg('a1', null, 2), msg('u1p', 'u1', 3)],
    [
      msg('u1', null, 1),
      msg('a1', null, 2),
      msg('u2', null, 3),
      msg('a2', null, 4),
      msg('u2p', 'u2', 5),
      msg('a2p', null, 6),
      msg('u3', null, 7),
      msg('a3', null, 8),
    ],
    [
      msg('u2', null, 1),
      msg('u2p', 'u2', 2),
      msg('u2pp', 'u2p', 3),
    ],
  ]
  for (const s of scenarios) {
    assert.deepEqual(ids(buildThreadForChoice(s, {})), ids(buildActiveThread(s)))
  }
})

test('원본 버전 선택 시 과거 꼬리(a2 u3 a3) 복원 표시', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u3', null, 5),
    msg('a3', null, 6),
    msg('u2p', 'u2', 7), // u2 편집 — 최신 활성은 [u1,a1,u2p]
  ]
  // 최신(기본)
  assert.deepEqual(ids(buildThreadForChoice(sorted, {})), ['u1', 'a1', 'u2p'])
  // 원본 u2 선택 → 과거 꼬리 복원
  assert.deepEqual(ids(buildThreadForChoice(sorted, { u2: 'u2' })), [
    'u1', 'a1', 'u2', 'a2', 'u3', 'a3',
  ])
})

test('중간 버전 선택 + 그 분기 꼬리 복원 (skip 모드)', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u2p', 'u2', 5),
    msg('a2p', null, 6), // u2p의 응답
    msg('u2pp', 'u2p', 7), // u2p를 다시 편집 → 최신
  ]
  // 최신(u2pp)
  assert.deepEqual(ids(buildThreadForChoice(sorted, {})), ['u1', 'a1', 'u2pp'])
  // 중간 u2p 선택 → u2p와 그 응답 a2p 복원, u2pp 제외
  assert.deepEqual(ids(buildThreadForChoice(sorted, { u2: 'u2p' })), [
    'u1', 'a1', 'u2p', 'a2p',
  ])
  // 원본 u2 선택 → u2와 그 응답 a2 복원
  assert.deepEqual(ids(buildThreadForChoice(sorted, { u2: 'u2' })), [
    'u1', 'a1', 'u2', 'a2',
  ])
})

test('무효 choice(그룹에 없는 versionId)는 무시 → 최신 폴백', () => {
  const sorted = [
    msg('u1', null, 1),
    msg('a1', null, 2),
    msg('u2', null, 3),
    msg('a2', null, 4),
    msg('u2p', 'u2', 5),
  ]
  assert.deepEqual(ids(buildThreadForChoice(sorted, { u2: 'nonexistent' })), ['u1', 'a1', 'u2p'])
})
