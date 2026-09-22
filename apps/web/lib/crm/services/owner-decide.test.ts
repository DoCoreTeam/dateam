/**
 * 담당자를 바꿔도 되는가 — 경우의 수를 전부 센다
 *
 * 이관·인수·재배정 셋의 조건이 서로 다르고, 특히 **이관과 인수는 방향만 반대인데 조건이 반대**다.
 * 하나로 뭉뚱그리면 둘 중 하나가 반드시 틀린다. 그래서 여기서 갈라 둔다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideReassign, reachableUserIds, ALL_USERS, REASSIGN_DENY_MESSAGE,
  type OrgSnapshot, type ReassignInput,
} from './owner-decide.ts'
import type { OrgNode, ClosureRow } from '../../org-scope-pure.ts'

const node = (
  id: string, type: OrgNode['type'], parent: string | null, name: string,
  head: string | null = null, user: string | null = null,
): OrgNode => ({ id, type, parent_id: parent, name, head_user_id: head, user_id: user })

/*
  회사(대표 u_ceo)
   ├ 영업본부(본부장 u_head)
   │   └ 영업1팀(팀장 u_lead) ─ 사원 u_a, u_b
   └ 개발본부(본부장 u_dev)
       └ 개발1팀 ─ 사원 u_x
*/
const NODES: OrgNode[] = [
  node('n_co', 'company', null, '회사', 'u_ceo'),
  node('n_sales', 'department', 'n_co', '영업본부', 'u_head'),
  node('n_t1', 'department', 'n_sales', '영업1팀', 'u_lead'),
  node('p_a', 'person', 'n_t1', '가', null, 'u_a'),
  node('p_b', 'person', 'n_t1', '나', null, 'u_b'),
  node('n_devhq', 'department', 'n_co', '개발본부', 'u_dev'),
  node('n_d1', 'department', 'n_devhq', '개발1팀'),
  node('p_x', 'person', 'n_d1', '다', null, 'u_x'),
]

/** 조상 사슬. depth 0 은 자기 자신 */
const CLOSURE: ClosureRow[] = [
  ['n_co', 'n_co', 0], ['n_co', 'n_sales', 1], ['n_co', 'n_t1', 2], ['n_co', 'p_a', 3], ['n_co', 'p_b', 3],
  ['n_co', 'n_devhq', 1], ['n_co', 'n_d1', 2], ['n_co', 'p_x', 3],
  ['n_sales', 'n_sales', 0], ['n_sales', 'n_t1', 1], ['n_sales', 'p_a', 2], ['n_sales', 'p_b', 2],
  ['n_t1', 'n_t1', 0], ['n_t1', 'p_a', 1], ['n_t1', 'p_b', 1],
  ['n_devhq', 'n_devhq', 0], ['n_devhq', 'n_d1', 1], ['n_devhq', 'p_x', 2],
  ['n_d1', 'n_d1', 0], ['n_d1', 'p_x', 1],
  ['p_a', 'p_a', 0], ['p_b', 'p_b', 0], ['p_x', 'p_x', 0],
].map(([a, d, n]) => ({ ancestor_id: a as string, descendant_id: d as string, depth: n as number }))

const ORG: OrgSnapshot = { nodes: NODES, closure: CLOSURE }

const base = (over: Partial<ReassignInput>): ReassignInput => ({
  actorUserId: 'u_a',
  currentOwnerUserId: 'u_a',
  nextOwnerUserId: 'u_b',
  nextIsActiveMember: true,
  canReassign: false,
  reach: ['u_a'],
  ...over,
})

// ── 범위 ──────────────────────────────────────────────────

test('전사 범위인 사람은 전부 손댈 수 있다', () => {
  assert.equal(reachableUserIds('u_ceo', ORG), ALL_USERS)
})

test('본부장은 루트 직속이라 전사 범위다', () => {
  /*
    이 저장소의 조직 규칙이다 — 회사 바로 아래 노드의 장은 전사로 본다(lib/access/capabilities.ts).
    여기서 다시 정의하지 않고 그 규칙을 그대로 쓴다. 처음엔 본부장을 부서 범위로 알고 시험을
    짰다가 여기서 걸렸다 — **범위 규칙은 한 곳에만 있어야 한다**는 것이 확인된 셈이다.
  */
  assert.equal(reachableUserIds('u_head', ORG), ALL_USERS)
})

test('팀장은 자기 서브트리 안만 손댈 수 있다', () => {
  const reach = reachableUserIds('u_lead', ORG)
  assert.notEqual(reach, ALL_USERS)
  const ids = reach as readonly string[]
  assert.ok(ids.includes('u_a'), '자기 팀 사원')
  assert.ok(ids.includes('u_b'), '자기 팀 사원')
  assert.ok(!ids.includes('u_x'), '다른 본부 사람은 범위 밖이어야 한다')
  assert.ok(!ids.includes('u_dev'), '다른 본부장도 범위 밖')
  assert.ok(!ids.includes('u_head'), '내 위 본부장도 범위 밖 — 위로는 안 뻗는다')
})

test('관할이 없는 사람은 자기 자신뿐이다', () => {
  assert.deepEqual(reachableUserIds('u_a', ORG), ['u_a'])
})

// ── 이관: 내 담당을 남에게 ────────────────────────────────

test('이관은 담당자 본인이면 권한 없이 된다', () => {
  // 휴가·인수인계에 승인을 받게 하면 아무도 안 넘기고 그냥 방치한다
  const d = decideReassign(base({ actorUserId: 'u_a', currentOwnerUserId: 'u_a', nextOwnerUserId: 'u_b' }))
  assert.deepEqual(d, { ok: true, kind: 'handover' })
})

test('이관은 범위 밖 사람에게도 된다', () => {
  // 사원의 범위는 자기 자신뿐이다. 그걸로 이관까지 막으면 아무에게도 못 넘긴다
  const d = decideReassign(base({ nextOwnerUserId: 'u_x', reach: ['u_a'] }))
  assert.deepEqual(d, { ok: true, kind: 'handover' })
})

// ── 인수: 남의 담당을 나에게 ──────────────────────────────

test('인수는 권한이 없으면 막힌다', () => {
  // 이관과 방향만 반대인데 조건은 반대다 — 열어 두면 남의 실적을 가져갈 수 있다
  const d = decideReassign(base({
    actorUserId: 'u_b', currentOwnerUserId: 'u_a', nextOwnerUserId: 'u_b', canReassign: false,
  }))
  assert.deepEqual(d, { ok: false, reason: 'not_owner' })
})

test('인수는 권한과 범위가 있으면 된다', () => {
  const d = decideReassign(base({
    actorUserId: 'u_lead', currentOwnerUserId: 'u_a', nextOwnerUserId: 'u_lead',
    canReassign: true, reach: reachableUserIds('u_lead', ORG),
  }))
  assert.deepEqual(d, { ok: true, kind: 'takeover' })
})

// ── 재배정: 남에서 또 다른 남으로 ─────────────────────────

test('재배정은 권한과 범위가 있으면 된다', () => {
  const d = decideReassign(base({
    actorUserId: 'u_lead', currentOwnerUserId: 'u_a', nextOwnerUserId: 'u_b',
    canReassign: true, reach: reachableUserIds('u_lead', ORG),
  }))
  assert.deepEqual(d, { ok: true, kind: 'reassign' })
})

test('권한이 있어도 범위 밖이면 막힌다 — 받는 쪽', () => {
  // 팀장이 자기 팀 딜을 다른 본부 사람에게 내보내면 그 딜은 관할을 벗어난다
  const d = decideReassign(base({
    actorUserId: 'u_lead', currentOwnerUserId: 'u_a', nextOwnerUserId: 'u_x',
    canReassign: true, reach: reachableUserIds('u_lead', ORG),
  }))
  assert.deepEqual(d, { ok: false, reason: 'out_of_range' })
})

test('권한이 있어도 범위 밖이면 막힌다 — 주는 쪽', () => {
  // 한쪽만 보면 범위 밖 사람 것을 끌어올 수 있다
  const d = decideReassign(base({
    actorUserId: 'u_lead', currentOwnerUserId: 'u_x', nextOwnerUserId: 'u_a',
    canReassign: true, reach: reachableUserIds('u_lead', ORG),
  }))
  assert.deepEqual(d, { ok: false, reason: 'out_of_range' })
})

test('전사 범위면 어느 쪽이든 된다', () => {
  const d = decideReassign(base({
    actorUserId: 'u_ceo', currentOwnerUserId: 'u_x', nextOwnerUserId: 'u_a',
    canReassign: true, reach: ALL_USERS,
  }))
  assert.deepEqual(d, { ok: true, kind: 'reassign' })
})

// ── 막는 나머지 ───────────────────────────────────────────

test('같은 사람으로 바꾸면 아무 일도 안 한다', () => {
  const d = decideReassign(base({ currentOwnerUserId: 'u_b', nextOwnerUserId: 'u_b', canReassign: true, reach: ALL_USERS }))
  assert.deepEqual(d, { ok: false, reason: 'no_change' })
})

test('나간 사람에게는 못 넘긴다', () => {
  // 넘기는 순간 주인 없는 행이 된다
  const d = decideReassign(base({ nextIsActiveMember: false }))
  assert.deepEqual(d, { ok: false, reason: 'unknown_member' })
})

test('담당자가 비어 있으면 범위를 안 따진다', () => {
  // 주인 없는 행은 누구의 것도 아니다. 범위로 막으면 아무도 못 주워 간다
  const d = decideReassign(base({
    actorUserId: 'u_lead', currentOwnerUserId: null, nextOwnerUserId: 'u_a',
    canReassign: true, reach: reachableUserIds('u_lead', ORG),
  }))
  assert.deepEqual(d, { ok: true, kind: 'reassign' })
})

test('거절 사유마다 다른 문장이 있다', () => {
  // 권한이 없어서 막힌 것과 범위 밖이라 막힌 것을 사용자가 구분할 수 있어야 한다
  const msgs = Object.values(REASSIGN_DENY_MESSAGE)
  assert.equal(new Set(msgs).size, msgs.length, '같은 문장을 두 사유가 쓰면 구분이 안 된다')
  for (const m of msgs) assert.ok(m.length > 0)
})
