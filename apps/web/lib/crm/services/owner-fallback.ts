/**
 * 담당자가 비면 조직 상위가 대신 맡는다 — 순수 판정
 *
 * ## 왜 필요한가
 *
 * 담당자 칸이 비는 일은 반드시 생긴다. 사람이 나가고, 부서가 개편되고, 예전에 들어온
 * 데이터에는 애초에 값이 없다(거래처 381건이 그랬다). 그때 **아무나 맡지 않으면 주인 없는 행이
 * 쌓이고**, 그 행은 누구의 목록에도 안 뜬다.
 *
 * ## 왜 값을 안 박고 계산하나
 *
 * 멤버를 내보낼 때 담당 건을 옮겨 박을 수도 있다. 그러면 두 가지를 잃는다.
 *
 *   ① **실제 배정과 자동 승계를 구분할 수 없다.** 박아 두면 둘 다 그냥 담당자다.
 *      화면이 「대행」이라고 말해 주려면 그 둘이 달라야 한다.
 *   ② **조직 개편을 안 따라간다.** 박은 값은 그 자리에 남고, 계산은 새 조직도를 따라간다.
 *
 * 그리고 박는 쪽을 고르면 내보내기를 막게 된다 — 받을 사람을 정해야 진행되니까.
 * 이 저장소는 「기록이 사용자 저장을 막으면 안 된다」를 이미 원칙으로 두고 있다.
 * 퇴사는 시스템이 협상할 일이 아니다.
 *
 * ## 규칙
 *
 *   1. 그 사람이 속한 가장 가까운 상위 조직의 **부서장**
 *   2. 그 자리가 비었거나 **본인이 그 부서장이면** 한 단계 위로
 *   3. 계속 올라가고 최상위는 대표
 *   4. 조직에 안 걸린 사람이면 대표, 대표도 없으면 빈 값 (멈추지 않는다)
 *
 * DB 를 안 본다 — 조직도 스냅샷을 받아 계산만 한다. 그래야 시험이 돈다.
 */

import type { OrgNode, ClosureRow } from '../../org-scope-pure.ts'

export interface OrgSnapshot {
  nodes: readonly OrgNode[]
  closure: readonly ClosureRow[]
}

/** 대행 판정 결과 — 왜 그 사람인지까지 돌려준다. 화면이 「대행」이라고 말해야 하기 때문 */
export interface ActingOwner {
  /** 대신 맡을 사람의 host user id. 못 찾으면 null */
  userId: string | null
  /** 어느 조직의 장으로서 맡는가. 대표까지 올라갔으면 그 노드, 못 찾으면 null */
  viaNodeName: string | null
}

const NONE: ActingOwner = { userId: null, viaNodeName: null }

/**
 * 조직도에서 그 사람의 자리를 찾는다.
 *
 * person 노드가 먼저다. 부서장은 person 자식 없이 부서 노드의 `head_user_id` 로만
 * 연결될 수 있어서(조직도 정의상 그것도 소속이다) 그 경우도 받는다.
 */
function anchorOf(userId: string, nodes: readonly OrgNode[]): OrgNode | null {
  return nodes.find((n) => n.type === 'person' && n.user_id === userId)
    ?? nodes.find((n) => n.head_user_id === userId)
    ?? null
}

/** 최상위(회사) 노드의 장 — 사다리 끝 */
function apexOf(nodes: readonly OrgNode[]): ActingOwner {
  const root = nodes.find((n) => n.parent_id === null)
  if (!root?.head_user_id) return NONE
  return { userId: root.head_user_id, viaNodeName: root.name }
}

/**
 * `ownerUserId` 를 대신 맡을 사람.
 *
 * `ownerUserId` 가 null 이면(담당자가 아예 없으면) 대표가 맡는다 — 어디서 시작할지 모르니
 * 사다리의 끝에서 시작하는 것이 유일하게 말이 되는 답이다.
 */
export function actingOwnerOf(
  ownerUserId: string | null | undefined,
  org: OrgSnapshot,
): ActingOwner {
  const { nodes, closure } = org
  if (!nodes.length) return NONE
  if (!ownerUserId) return apexOf(nodes)

  const anchor = anchorOf(ownerUserId, nodes)
  if (!anchor) return apexOf(nodes)

  const byId = new Map(nodes.map((n) => [n.id, n] as const))

  // 가까운 조상부터 — depth 0 은 자기 자신이라 뺀다
  const ancestors = closure
    .filter((c) => c.descendant_id === anchor.id && c.depth > 0)
    .sort((a, b) => a.depth - b.depth)
    .map((c) => byId.get(c.ancestor_id))
    .filter((n): n is OrgNode => !!n)

  for (const node of ancestors) {
    // 본인이 그 부서의 장이면 그 자리로는 못 넘긴다 — 한 단계 더 올라간다
    if (node.head_user_id && node.head_user_id !== ownerUserId) {
      return { userId: node.head_user_id, viaNodeName: node.name }
    }
  }

  // 조상 사슬에 장이 하나도 없다 (조직도가 덜 채워진 경우). 대표로 간다
  const apex = apexOf(nodes)
  return apex.userId && apex.userId !== ownerUserId ? apex : NONE
}

/**
 * 담당자를 화면에 그릴 때 쓰는 답.
 *
 * `acting` 이 true 면 화면은 「대행」을 붙이고 담당자를 정하라고 말한다.
 * 실제 배정과 구분되지 않으면 아무도 안 정한다.
 */
export interface ResolvedOwner {
  userId: string | null
  acting: boolean
  viaNodeName: string | null
}

/**
 * 담당자 칸의 값과 조직도를 합쳐 **실제로 지금 누가 맡고 있는지**를 낸다.
 *
 * @param ownerUserId 담당자 칸에 든 값 (host user id). 비었으면 null
 * @param isActiveMember 그 사람이 아직 이 서비스의 멤버인가. 나갔으면 false
 */
export function resolveOwner(
  ownerUserId: string | null | undefined,
  isActiveMember: boolean,
  org: OrgSnapshot,
): ResolvedOwner {
  if (ownerUserId && isActiveMember) {
    return { userId: ownerUserId, acting: false, viaNodeName: null }
  }
  const acting = actingOwnerOf(ownerUserId ?? null, org)
  return { userId: acting.userId, acting: true, viaNodeName: acting.viaNodeName }
}
