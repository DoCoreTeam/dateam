/**
 * 담당자를 바꾼다(딜·거래처·고객) — 판정은 `owner-decide.ts`, 여기는 그 판정에 필요한 값을 모으고 쓴다
 *
 * ## 세 개체가 판정을 나눠 쓴다
 *
 * 거래처와 고객에 담당자 변경을 붙이면서 딜의 판정을 복사할 뻔했다. 복사하면 그날부터
 * 두 벌이 되고, 한쪽만 고쳐지는 날 **권한이 개체마다 다르게 걸린다.**
 * 그래서 「누가 바꿔도 되나」는 `decideOwnerChange` 한 곳만 지난다. 개체마다 다른 것은
 * 표 이름·기록 이름·화면에 쓸 말 셋뿐이고 그건 `ENTITY` 표에 값으로 적는다.
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
import { ENTITY } from '../../terms/entity.ts'
import { eulReul, withJosa } from '../../ui/josa.ts'

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

/**
 * 「이 사람이 이 행의 담당자를 저 사람으로 바꿔도 되나」 — **세 개체가 이 한 곳만 지난다.**
 *
 * 판정 자체는 `decideReassign` 이 값으로 하고, 여기는 그 앞에 필요한 대조를 붙인다.
 * 멤버 id 와 호스트 사용자 id 를 맞추는 일이 그것이고, 안 맞추면 범위 판정이 늘 「범위 밖」이 된다.
 *
 * 거절은 던진다. 부르는 쪽이 `if (!ok)` 를 잊어도 조용히 통과하지 않게 하려는 것이다.
 */
async function decideOwnerChange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  input: {
    actorMemberId: string
    currentOwnerId: string | null
    nextOwnerMemberId: string
    canReassign: boolean
    org: OrgSnapshot
  },
): Promise<{ kind: ReassignKind }> {
  const members = await loadMembers(tx)
  const actorUserId = members.hostOf.get(input.actorMemberId)
  if (!actorUserId) throw new CrmError('FORBIDDEN', '이 CRM 의 멤버가 아닙니다.')

  const decision = decideReassign({
    actorUserId,
    // 대조가 안 되는 값(나간 멤버가 담당이던 경우)은 «주인 없음»으로 본다
    currentOwnerUserId: input.currentOwnerId
      ? members.hostOf.get(input.currentOwnerId) ?? null
      : null,
    nextOwnerUserId: members.hostOf.get(input.nextOwnerMemberId) ?? '',
    nextIsActiveMember: members.active.has(input.nextOwnerMemberId),
    canReassign: input.canReassign,
    reach: reachableUserIds(actorUserId, input.org),
  })
  if (!decision.ok) {
    // 「이미 그 사람」은 막을 일이지 권한 문제가 아니다 — 코드를 나눠야 화면이 맞게 말한다
    throw new CrmError(
      decision.reason === 'no_change' ? 'VALIDATION_FAILED' : 'FORBIDDEN',
      REASSIGN_DENY_MESSAGE[decision.reason],
    )
  }
  return { kind: decision.kind }
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

    const decision = await decideOwnerChange(tx, {
      actorMemberId,
      currentOwnerId: before.ownerId,
      nextOwnerMemberId,
      canReassign,
      org,
    })

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

/**
 * 거래처·고객은 무엇이 다른가 — **표 이름·기록 이름·화면에 쓸 말 셋뿐이다.**
 * 판정도 잠금도 기록도 딜과 같은 것을 쓴다. 여기 값을 더하는 것 말고
 * 함수를 하나 더 쓰기 시작하면 그날부터 규칙이 갈린다.
 */
const SIMPLE_ENTITY = {
  company: { delegate: 'crmCompany', action: 'company.owner_changed', target: 'company' },
  person: { delegate: 'crmPerson', action: 'person.owner_changed', target: 'person' },
} as const

export type SimpleOwnerEntity = keyof typeof SIMPLE_ENTITY

export interface SimpleReassignInput {
  id: string
  version: number
  nextOwnerMemberId: string
  canReassign: boolean
  org: OrgSnapshot
}

/**
 * 거래처·고객의 담당자를 바꾼다.
 *
 * 딜과 달리 **딸려 옮길 것을 안 받는다.** 딜은 그 아래 할 일과 견적이 매달려 있어
 * 안 옮기면 이전 담당자 화면에 계속 뜨지만, 거래처와 고객은 그렇게 매달린 것이 없다.
 * 나중에 생기면 그때 `CascadeOptions` 를 여기에도 붙인다 — 지금 없는 것을 미리 받지 않는다.
 */
async function reassignSimpleOwner(
  entity: SimpleOwnerEntity,
  workspaceId: string,
  actorMemberId: string,
  input: SimpleReassignInput,
): Promise<ReassignResult> {
  const meta = SIMPLE_ENTITY[entity]
  const { id, version, nextOwnerMemberId, canReassign, org } = input

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (tx as any)[meta.delegate]
    const before = await table.findFirst({
      where: { id },
      select: { id: true, ownerId: true, version: true },
    }) as { id: string; ownerId: string | null; version: number } | null
    // 말은 용어집이 정하고 조사는 받침이 정한다 — 「인물를」이 안 나오게
    const label = ENTITY[entity].label
    if (!before) throw new CrmError('NOT_FOUND', `${withJosa(label, eulReul)} 찾을 수 없습니다.`)

    const decision = await decideOwnerChange(tx, {
      actorMemberId,
      currentOwnerId: before.ownerId,
      nextOwnerMemberId,
      canReassign,
      org,
    })

    const res = await table.updateMany({
      where: lockWhere(id, version),
      data: { ownerId: nextOwnerMemberId, ...BUMP_VERSION },
    })
    assertUpdated(res.count, { exists: true, version: before.version }, label)

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId: actorMemberId,
      action: meta.action, targetType: meta.target, targetId: id,
      beforeJson: { ownerId: before.ownerId },
      afterJson: { ownerId: nextOwnerMemberId, kind: decision.kind },
    })

    return {
      kind: decision.kind,
      fromMemberId: before.ownerId,
      toMemberId: nextOwnerMemberId,
      // 딸려 옮긴 것이 없다는 뜻이다. 「안 셌다」가 아니라 「없다」다
      moved: { tasks: 0, quotes: 0 },
    }
  })
}

export function reassignCompanyOwner(
  workspaceId: string, actorMemberId: string, input: SimpleReassignInput,
): Promise<ReassignResult> {
  return reassignSimpleOwner('company', workspaceId, actorMemberId, input)
}

export function reassignPersonOwner(
  workspaceId: string, actorMemberId: string, input: SimpleReassignInput,
): Promise<ReassignResult> {
  return reassignSimpleOwner('person', workspaceId, actorMemberId, input)
}
