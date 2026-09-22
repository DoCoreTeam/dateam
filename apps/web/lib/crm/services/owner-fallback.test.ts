/**
 * 담당자가 비면 조직 상위가 대신 맡는다
 *
 * 실제 조직도 모양으로 시험한다 — 회사 > 본부 > 팀 > 사람.
 * 부서장이 person 자식 없이 부서 노드의 head_user_id 로만 달리는 경우가 실제로 있어서
 * 그 모양도 함께 넣는다(이 저장소 조직도 정의).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actingOwnerOf, resolveOwner, type OrgSnapshot } from './owner-fallback.ts'
import type { OrgNode, ClosureRow } from '../../org-scope-pure.ts'

const node = (
  id: string, type: OrgNode['type'], parent: string | null, name: string,
  head: string | null = null, user: string | null = null,
): OrgNode => ({ id, type, parent_id: parent, name, head_user_id: head, user_id: user })

/*
  회사(대표=u_ceo)
   └ 본부(본부장=u_head)
      └ 영업1팀(팀장=u_lead)
         ├ 사원 u_a
         └ 사원 u_b
  그리고 팀장 u_lead 는 person 노드가 없다 — head_user_id 로만 달려 있다
*/
const NODES: OrgNode[] = [
  node('n_co', 'company', null, '데이터얼라이언스', 'u_ceo'),
  node('n_hq', 'department', 'n_co', 'AX사업본부', 'u_head'),
  node('n_t1', 'department', 'n_hq', '영업1팀', 'u_lead'),
  node('p_a', 'person', 'n_t1', '사원 가', null, 'u_a'),
  node('p_b', 'person', 'n_t1', '사원 나', null, 'u_b'),
]

/** 조상 사슬을 손으로 적는다 — depth 0 은 자기 자신 */
const CLOSURE: ClosureRow[] = [
  { ancestor_id: 'n_co', descendant_id: 'n_co', depth: 0 },
  { ancestor_id: 'n_co', descendant_id: 'n_hq', depth: 1 },
  { ancestor_id: 'n_hq', descendant_id: 'n_hq', depth: 0 },
  { ancestor_id: 'n_co', descendant_id: 'n_t1', depth: 2 },
  { ancestor_id: 'n_hq', descendant_id: 'n_t1', depth: 1 },
  { ancestor_id: 'n_t1', descendant_id: 'n_t1', depth: 0 },
  { ancestor_id: 'n_co', descendant_id: 'p_a', depth: 3 },
  { ancestor_id: 'n_hq', descendant_id: 'p_a', depth: 2 },
  { ancestor_id: 'n_t1', descendant_id: 'p_a', depth: 1 },
  { ancestor_id: 'p_a', descendant_id: 'p_a', depth: 0 },
  { ancestor_id: 'n_co', descendant_id: 'p_b', depth: 3 },
  { ancestor_id: 'n_hq', descendant_id: 'p_b', depth: 2 },
  { ancestor_id: 'n_t1', descendant_id: 'p_b', depth: 1 },
  { ancestor_id: 'p_b', descendant_id: 'p_b', depth: 0 },
]

const ORG: OrgSnapshot = { nodes: NODES, closure: CLOSURE }

test('사원이 나가면 그 팀의 팀장이 맡는다', () => {
  const r = actingOwnerOf('u_a', ORG)
  assert.equal(r.userId, 'u_lead')
  assert.equal(r.viaNodeName, '영업1팀')
})

test('팀장이 나가면 한 단계 위인 본부장이 맡는다', () => {
  // 본인이 그 팀의 장이라 그 자리로는 못 넘긴다
  const r = actingOwnerOf('u_lead', ORG)
  assert.equal(r.userId, 'u_head')
  assert.equal(r.viaNodeName, 'AX사업본부')
})

test('본부장이 나가면 대표가 맡는다', () => {
  const r = actingOwnerOf('u_head', ORG)
  assert.equal(r.userId, 'u_ceo')
  assert.equal(r.viaNodeName, '데이터얼라이언스')
})

test('부서장이 안 정해진 단계는 건너뛰고 더 올라간다', () => {
  const noLead = NODES.map((n) => (n.id === 'n_t1' ? { ...n, head_user_id: null } : n))
  const r = actingOwnerOf('u_a', { nodes: noLead, closure: CLOSURE })
  assert.equal(r.userId, 'u_head', '팀장 자리가 비면 본부장이 맡는다')
})

test('담당자가 아예 없으면 대표가 맡는다', () => {
  // 어디서 시작할지 모르니 사다리의 끝에서 시작하는 것이 유일하게 말이 되는 답이다
  assert.equal(actingOwnerOf(null, ORG).userId, 'u_ceo')
  assert.equal(actingOwnerOf(undefined, ORG).userId, 'u_ceo')
})

test('조직에 안 걸린 사람이어도 멈추지 않는다', () => {
  const r = actingOwnerOf('u_없는사람', ORG)
  assert.equal(r.userId, 'u_ceo', '조직 밖이면 대표가 맡는다')
})

test('조직도가 비어 있어도 멈추지 않는다', () => {
  // 빈 값을 돌려주고 화면이 처리한다. 여기서 던지면 목록 전체가 안 뜬다
  const r = actingOwnerOf('u_a', { nodes: [], closure: [] })
  assert.equal(r.userId, null)
  assert.equal(r.viaNodeName, null)
})

test('대표 본인이 나가면 대신할 사람이 없다', () => {
  // 자기 자신을 대행으로 돌려주지 않는다 — 그건 아무것도 안 바뀐 것이다
  const r = actingOwnerOf('u_ceo', ORG)
  assert.equal(r.userId, null)
})

test('대표 자리가 비어 있어도 멈추지 않는다', () => {
  const noCeo = NODES.map((n) => (n.id === 'n_co' ? { ...n, head_user_id: null } : n))
  const r = actingOwnerOf('u_head', { nodes: noCeo, closure: CLOSURE })
  assert.equal(r.userId, null)
})

test('담당자가 살아 있는 멤버면 대행이 아니다', () => {
  const r = resolveOwner('u_a', true, ORG)
  assert.equal(r.userId, 'u_a')
  assert.equal(r.acting, false, '멀쩡한 담당자에게 대행 표시가 붙으면 안 된다')
})

test('담당자가 멤버에서 빠졌으면 대행으로 올라간다', () => {
  const r = resolveOwner('u_a', false, ORG)
  assert.equal(r.userId, 'u_lead')
  assert.equal(r.acting, true, '화면이 대행이라고 말해야 사람이 다시 정한다')
  assert.equal(r.viaNodeName, '영업1팀')
})

test('담당자 칸이 비어 있으면 대행이다', () => {
  const r = resolveOwner(null, true, ORG)
  assert.equal(r.userId, 'u_ceo')
  assert.equal(r.acting, true)
})
