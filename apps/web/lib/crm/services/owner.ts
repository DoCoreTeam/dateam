/**
 * 딜 담당자를 바꾼다 — 판정은 `owner-decide.ts`, 여기는 그 판정에 필요한 값을 모으고 쓴다
 *
 * ## 값이 두 벌이라 대조가 필요하다
 *
 * 담당자 칸(`crm_deal.ownerId`)은 **CrmMember.id** 를 담는다. 그런데 권한 범위는 조직도에서
 * 계산하고 조직도는 **호스트 사용자 id** 로 사람을 가리킨다. 둘을 안 맞추면 범위 판정이
 * 항상 「범위 밖」이 되고, 그 사실은 화면에서 「권한이 없습니다」로만 보인다.
 * 그래서 멤버 표를 한 번 읽어 양방향 대조표를 만든다.
 *
 * ## 딸린 것
 *
 * 딜만 넘기면 그 딜의 할 일은 이전 담당자 「오늘」 화면에 계속 뜬다. 그게 처음 문제로
 * 돌아가는 길이라 **같이 옮길지 물어서** 받는다. 확정된 견적은 기본이 안 옮김이다 —
 * 발송 책임자가 소급해 바뀌면 누가 책임지고 보냈는지가 흐려진다.
 */

import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { assertUpdated, lockWhere, BUMP_VERSION } from '../db/optimistic.ts'
import {
  decideReassign, reachableUserIds, REASSIGN_DENY_MESSAGE,
  type OrgSnapshot, type ReassignKind,
} from './owner-decide.ts'

/** 같이 옮길 것 — 화면이 건수를 보여 주고 고르게 한다 */
export interface CascadeOptions {
  /** 이 딜에 달린 할 일. 기본 켜짐 (안 옮기면 이전 담당자 오늘 화면에 계속 뜬다) */
  tasks?: boolean
  /** 아직 안 나간 견적. 기본 켜짐 */
  draftQuotes?: boolean
  /** 확정돼 나간 견적. **기본 꺼짐** — 발송 책임이 소급해 바뀌면 안 된다 */
  settledQuotes?: boolean
}

export interface ReassignResult {
  kind: ReassignKind
  fromMemberId: string | null
  toMemberId: string
  moved: { tasks: number; quotes: number }
}

/** 나가지 않은 멤버의 양방향 대조표 */
interface MemberMap {
  hostOf: Map<string, string>
  memberOf: Map<string, string>
  active: Set<string>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadMembers(tx: any): Promise<MemberMap> {
  const rows = await tx.crmMember.findMany({
    where: { deletedAt: null },
    select: { id: true, hostUserId: true },
  }) as { id: string; hostUserId: string }[]
  return {
    hostOf: new Map(rows.map((r) => [r.id, r.hostUserId])),
    memberOf: new Map(rows.map((r) => [r.hostUserId, r.id])),
    active: new Set(rows.map((r) => r.id)),
  }
}

/** 확정돼 나간 견적으로 보는 상태 — 이 상태의 담당자는 기본으로 안 옮긴다 */
const SETTLED_QUOTE_STATUS = ['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']

/**
 * @param actorMemberId 바꾸려는 사람의 CrmMember.id
 * @param canReassign   `owner.reassign` 권한을 가졌는가 (라우트가 관문으로 이미 판정한 값)
 */
export async function reassignDealOwner(
  workspaceId: string,
  actorMemberId: string,
  input: {
    dealId: string
    version: number
    nextOwnerMemberId: string
    canReassign: boolean
    org: OrgSnapshot
    cascade?: CascadeOptions
  },
): Promise<ReassignResult> {
  const { dealId, version, nextOwnerMemberId, canReassign, org } = input
  const cascade: Required<CascadeOptions> = {
    tasks: input.cascade?.tasks ?? true,
    draftQuotes: input.cascade?.draftQuotes ?? true,
    settledQuotes: input.cascade?.settledQuotes ?? false,
  }

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmDeal.findFirst({
      where: { id: dealId },
      select: { id: true, name: true, ownerId: true, version: true },
    }) as { id: string; name: string; ownerId: string | null; version: number } | null
    if (!before) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

    const members = await loadMembers(tx)
    const actorUserId = members.hostOf.get(actorMemberId)
    if (!actorUserId) throw new CrmError('FORBIDDEN', '이 CRM 의 멤버가 아닙니다.')

    const decision = decideReassign({
      actorUserId,
      // 대조가 안 되는 값(나간 멤버가 담당이던 경우)은 «주인 없음»으로 본다
      currentOwnerUserId: before.ownerId ? members.hostOf.get(before.ownerId) ?? null : null,
      nextOwnerUserId: members.hostOf.get(nextOwnerMemberId) ?? '',
      nextIsActiveMember: members.active.has(nextOwnerMemberId),
      canReassign,
      reach: reachableUserIds(actorUserId, org),
    })
    if (!decision.ok) {
      const message = REASSIGN_DENY_MESSAGE[decision.reason]
      // 「이미 그 사람」은 막을 일이지 권한 문제가 아니다 — 코드를 나눠야 화면이 맞게 말한다
      throw new CrmError(
        decision.reason === 'no_change' ? 'VALIDATION_FAILED' : 'FORBIDDEN',
        message,
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmDeal.updateMany({
      where: lockWhere(dealId, version),
      data: { ownerId: nextOwnerMemberId, ...BUMP_VERSION },
    })
    assertUpdated(res.count, { exists: true, version: before.version }, '딜')

    const moved = { tasks: 0, quotes: 0 }

    if (cascade.tasks) {
      // 끝난 할 일은 안 건드린다 — 지나간 일의 담당자를 바꾸면 그때 누가 했는지가 흐려진다
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (tx as any).crmTask.updateMany({
        where: { dealId, deletedAt: null, status: { in: ['TODO', 'DOING'] } },
        data: { assigneeId: nextOwnerMemberId },
      })
      moved.tasks = r.count
    }

    const quoteStatus = cascade.settledQuotes
      ? undefined
      : { notIn: SETTLED_QUOTE_STATUS }
    if (cascade.draftQuotes || cascade.settledQuotes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (tx as any).crmQuote.updateMany({
        where: { dealId, deletedAt: null, ...(quoteStatus ? { status: quoteStatus } : {}) },
        data: { ownerId: nextOwnerMemberId },
      })
      moved.quotes = r.count
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId: actorMemberId,
      action: 'deal.owner_changed', targetType: 'deal', targetId: dealId,
      beforeJson: { ownerId: before.ownerId },
      afterJson: { ownerId: nextOwnerMemberId, kind: decision.kind, moved },
    })

    return {
      kind: decision.kind,
      fromMemberId: before.ownerId,
      toMemberId: nextOwnerMemberId,
      moved,
    }
  })
}
