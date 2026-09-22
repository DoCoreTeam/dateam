/**
 * 담당자를 바꿔도 되는가 — 순수 판정
 *
 * 「담당자 변경」을 한 덩어리로 보면 규칙이 안 선다. 실제로는 셋이고 조건이 다르다.
 *
 *   · **이관** 내 담당을 남에게  — 담당자 본인이면 된다. 권한도 범위도 안 본다
 *   · **인수** 남의 담당을 나에게 — 권한이 있어야 한다. 이관과 **반대 방향**이다
 *   · **재배정** 남에서 또 다른 남으로 — 권한 + 양쪽이 내 권한 범위 안
 *
 * **왜 이관만 다른가**: 휴가·인수인계·퇴사 준비에 승인을 받게 하면 아무도 안 넘기고 그냥
 * 방치한다. 그리고 자기 것을 내놓는 쪽은 실적을 가져가는 일이 아니다. 반대로 **인수는 열어 두면
 * 남의 실적을 가져갈 수 있다** — 그래서 같은 「담당자 변경」인데 조건이 반대다.
 *
 * **왜 범위가 또 좁히나**: 권한이 있어도 남의 부서 사람 것까지 만지면 팀장이 전사 관리자가 된다.
 * 범위는 조직도에서 계산한다 — 여기서 다시 정의하지 않는다.
 *
 * DB 를 안 본다. 그래야 경우의 수를 전부 시험할 수 있다.
 */

import { rangeOfPerson } from '../../access/capabilities.ts'
import type { OrgNode, ClosureRow } from '../../org-scope-pure.ts'

export interface OrgSnapshot {
  nodes: readonly OrgNode[]
  closure: readonly ClosureRow[]
}

/** 바꾸는 방향 셋 — 화면과 기록이 같은 말을 쓰도록 이름을 고정한다 */
export type ReassignKind = 'handover' | 'takeover' | 'reassign'

export type ReassignDenyReason =
  | 'no_change'
  | 'not_owner'
  | 'out_of_range'
  | 'unknown_member'

export type ReassignDecision =
  | { ok: true; kind: ReassignKind }
  | { ok: false; reason: ReassignDenyReason }

/** 전사 범위는 목록으로 못 적는다 — 「전부」라는 답이 따로 있다 */
export const ALL_USERS = 'all' as const

/**
 * 이 사람이 손댈 수 있는 사람들.
 *
 * 전사면 `'all'`, 부서면 자기가 장인 조직의 서브트리에 있는 사람들, 아니면 자기 자신뿐이다.
 */
export function reachableUserIds(
  actorUserId: string,
  org: OrgSnapshot,
): readonly string[] | typeof ALL_USERS {
  const range = rangeOfPerson(actorUserId, org.nodes)
  if (range === 'all') return ALL_USERS
  if (range === 'self') return [actorUserId]

  // 내가 장인 노드들의 서브트리 — closure 가 이미 조상 사슬을 안다
  const ledNodeIds = org.nodes
    .filter((n) => n.head_user_id === actorUserId && n.type !== 'person')
    .map((n) => n.id)
  const inSubtree = new Set<string>(ledNodeIds)
  for (const c of org.closure) {
    if (ledNodeIds.includes(c.ancestor_id)) inSubtree.add(c.descendant_id)
  }

  const out = new Set<string>([actorUserId])
  for (const n of org.nodes) {
    if (!inSubtree.has(n.id)) continue
    if (n.type === 'person' && n.user_id) out.add(n.user_id)
    // 부서장은 person 노드 없이 head_user_id 로만 달릴 수 있다 — 그것도 소속이다
    if (n.head_user_id) out.add(n.head_user_id)
  }
  return [...out]
}

function within(reach: readonly string[] | typeof ALL_USERS, userId: string | null): boolean {
  if (!userId) return true // 담당자가 비어 있는 것은 누구의 것도 아니라 범위를 안 따진다
  return reach === ALL_USERS || reach.includes(userId)
}

export interface ReassignInput {
  /** 바꾸려는 사람 (host user id) */
  actorUserId: string
  /** 지금 담당자. 비어 있을 수 있다 */
  currentOwnerUserId: string | null
  /** 새 담당자 */
  nextOwnerUserId: string
  /** 새 담당자가 이 서비스의 살아 있는 멤버인가 */
  nextIsActiveMember: boolean
  /** `owner.reassign` 권한을 가졌는가 */
  canReassign: boolean
  /** 손댈 수 있는 사람들 */
  reach: readonly string[] | typeof ALL_USERS
}

export function decideReassign(input: ReassignInput): ReassignDecision {
  const { actorUserId, currentOwnerUserId, nextOwnerUserId, nextIsActiveMember, canReassign, reach } = input

  // 나간 사람에게 넘기면 그 행은 바로 주인 없는 행이 된다
  if (!nextIsActiveMember) return { ok: false, reason: 'unknown_member' }
  if (currentOwnerUserId === nextOwnerUserId) return { ok: false, reason: 'no_change' }

  // ① 이관 — 내 담당을 남에게. 권한도 범위도 안 본다
  if (currentOwnerUserId === actorUserId) return { ok: true, kind: 'handover' }

  // ②③ 남의 담당을 건드린다 — 권한이 먼저다
  if (!canReassign) return { ok: false, reason: 'not_owner' }

  // 양쪽 다 내 범위 안이어야 한다. 한쪽만 보면 범위 밖에서 끌어오거나 내보낼 수 있다
  if (!within(reach, currentOwnerUserId) || !within(reach, nextOwnerUserId)) {
    return { ok: false, reason: 'out_of_range' }
  }

  return { ok: true, kind: nextOwnerUserId === actorUserId ? 'takeover' : 'reassign' }
}

/** 거절 사유를 사람이 읽는 문장으로 — 왜 막혔는지를 구분해 말한다 */
export const REASSIGN_DENY_MESSAGE: Record<ReassignDenyReason, string> = {
  no_change: '이미 그 사람이 담당자입니다.',
  not_owner: '담당자를 바꿀 권한이 없습니다. 본인 담당은 직접 넘길 수 있습니다.',
  out_of_range: '내가 볼 수 있는 범위 밖의 담당자입니다.',
  unknown_member: '이 CRM 의 멤버가 아닙니다.',
}
