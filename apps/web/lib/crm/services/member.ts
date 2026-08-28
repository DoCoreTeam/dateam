// 멤버 (dacrm)
//
// **왜 이 파일이 생겼나**: 호스트에 사용자가 32명인데 CRM 멤버는 1명이었다.
// `resolveCrmAccess` 는 멤버가 아니면 막는데, **멤버로 넣을 화면이 없었다** —
// 즉 나머지 31명은 DB 를 직접 건드리지 않는 한 영영 못 들어온다.
// 혼자 쓰는 동안엔 안 보이지만, 팀이 쓰기 시작하는 순간 제품이 멈춘다.
//
// **여기서 지키는 것**: 관리자가 0명이 되는 상태를 만들지 않는다.
// 마지막 관리자를 내보내거나 강등하면 그 워크스페이스는 아무도 손댈 수 없는 상태가 된다 —
// 되돌리려면 DB 를 직접 고쳐야 하고, 그건 사용자가 할 수 있는 일이 아니다.

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { requireText, normalizeText } from '../domain/normalize.ts'
import type { CrmRole } from '../auth/requireCrmMember.ts'

export const ROLES: CrmRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'READONLY']

/** 관리 권한을 가진 역할 — 이 사람이 0명이 되면 워크스페이스가 잠긴다 */
const ADMIN_ROLES = new Set<CrmRole>(['OWNER', 'ADMIN'])

export const ROLE_LABEL: Record<CrmRole, string> = {
  OWNER: '소유자',
  ADMIN: '관리자',
  MEMBER: '멤버',
  READONLY: '보기만',
}

export const ROLE_HINT: Record<CrmRole, string> = {
  OWNER: '모든 것을 할 수 있고, 워크스페이스를 책임집니다',
  ADMIN: '설정·멤버·파이프라인을 바꿀 수 있습니다',
  MEMBER: '회사·인물·딜을 만들고 고칠 수 있습니다',
  READONLY: '보기만 하고 바꾸지는 못합니다',
}

export interface MemberRow {
  id: string
  hostUserId: string
  displayName: string
  email: string
  /** 직위 — 견적서 담당자 줄에 이름과 함께 찍힌다 */
  title: string | null
  /** 연락처 — 고객이 이 사람에게 직접 건다 */
  phone: string | null
  role: string
  createdAt: Date
  deletedAt: Date | null
}

const SELECT = {
  id: true, hostUserId: true, displayName: true, email: true,
  title: true, phone: true,
  role: true, createdAt: true, deletedAt: true,
} as const

export async function listMembers(db: CrmDb, opts: { trash?: boolean } = {}): Promise<MemberRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmMember.findMany({
    // 휴지통을 보려면 명시해야 한다 — 가드가 기본으로 deletedAt: null 을 건다
    where: opts.trash ? { deletedAt: { not: null } } : {},
    orderBy: [{ createdAt: 'asc' }],
    select: SELECT,
  })
}

/** 관리자가 몇 명 남는지 — 넣기 전에 세야 마지막 한 명을 지키는 판정이 된다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countAdmins(tx: any, excludeId?: string): Promise<number> {
  return tx.crmMember.count({
    where: {
      role: { in: Array.from(ADMIN_ROLES) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  })
}

function assertRole(role: unknown): CrmRole {
  if (typeof role !== 'string' || !ROLES.includes(role as CrmRole)) {
    throw new CrmError('VALIDATION_FAILED', '알 수 없는 권한입니다.', { field: 'role' })
  }
  return role as CrmRole
}

export interface AddMemberInput {
  hostUserId: string
  displayName: string
  email: string
  role?: string
}

/**
 * 팀원을 들인다.
 *
 * 이미 있던 사람을 다시 들이면 **되살린다** — 새로 만들면 같은 사람이 둘이 되고,
 * 그때부터 "누가 한 것인가"가 두 갈래로 갈린다(감사 기록이 못 쓰게 된다).
 */
export async function addMember(
  workspaceId: string,
  actorId: string | null,
  input: AddMemberInput,
): Promise<MemberRow> {
  const hostUserId = requireText(input.hostUserId)
  const displayName = requireText(input.displayName)
  const email = requireText(input.email)
  if (!hostUserId || !displayName) {
    throw new CrmError('VALIDATION_FAILED', '누구를 들일지 골라 주세요.', { field: 'hostUserId' })
  }
  const role = assertRole(input.role ?? 'MEMBER')

  return withCrmTx(workspaceId, async (tx) => {
    // 삭제된 것까지 본다 — 내보낸 사람을 다시 들이는 경우가 흔하다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (tx as any).crmMember.findFirst({
      where: { hostUserId, deletedAt: undefined }, select: SELECT,
    })

    if (existing && !existing.deletedAt) {
      throw new CrmError('CONFLICT', '이미 이 워크스페이스의 멤버입니다.', { field: 'hostUserId' })
    }

    if (existing) {
      /**
       * 되살리기는 삭제된 행을 명시해야 한다.
       * 가드가 조회에 `deletedAt: null` 을 자동으로 넣기 때문에 그냥 id 로만 걸면
       * **0건 업데이트**가 되고, 화면은 200 을 받고도 아무 일도 일어나지 않는다(실측).
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const revived = await (tx as any).crmMember.updateMany({
        where: { id: existing.id, deletedAt: { not: null } },
        data: { deletedAt: null, role, displayName, email: email ?? existing.email },
      })
      if (revived.count === 0) {
        throw new CrmError('CONFLICT', '멤버 상태가 그 사이 바뀌었어요. 새로고침 후 다시 시도해 주세요.')
      }
      await writeAudit(tx, {
        actorType: 'HUMAN', actorId, action: 'member.restored',
        targetType: 'member', targetId: existing.id,
        beforeJson: { deletedAt: existing.deletedAt, role: existing.role },
        afterJson: { role, displayName },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tx as any).crmMember.findFirst({ where: { id: existing.id }, select: SELECT })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmMember.create({
      data: { hostUserId, displayName, email: email ?? '', role },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'member.added',
      targetType: 'member', targetId: created.id,
      afterJson: { displayName, email, role },
    })
    return created
  })
}

export async function changeMemberRole(
  workspaceId: string,
  actorId: string | null,
  memberId: string,
  nextRole: unknown,
): Promise<MemberRow> {
  const role = assertRole(nextRole)

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmMember.findFirst({ where: { id: memberId }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '멤버를 찾을 수 없습니다.')
    if (before.role === role) return before

    /**
     * 마지막 관리자를 강등하면 아무도 설정을 못 바꾼다.
     * 되돌리려면 DB 를 직접 고쳐야 하고, 그건 사용자가 할 수 있는 일이 아니다.
     */
    if (ADMIN_ROLES.has(before.role as CrmRole) && !ADMIN_ROLES.has(role)) {
      const others = await countAdmins(tx, memberId)
      if (others === 0) {
        throw new CrmError('VALIDATION_FAILED',
          '마지막 관리자예요. 다른 사람을 관리자로 올린 다음에 바꿔 주세요.', { field: 'role' })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMember.updateMany({ where: { id: memberId }, data: { role } })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'member.role_changed',
      targetType: 'member', targetId: memberId,
      beforeJson: { role: before.role }, afterJson: { role, displayName: before.displayName },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (tx as any).crmMember.findFirst({ where: { id: memberId }, select: SELECT })
  })
}

/**
 * 내보낸다 — 소프트 삭제다.
 *
 * 지우지 않는 이유: 이 사람 id 가 감사 기록·딜 담당자·활동에 박혀 있다.
 * 지우면 "누가 한 것인가"가 통째로 빈칸이 된다.
 */
export async function removeMember(
  workspaceId: string,
  actorId: string | null,
  memberId: string,
): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmMember.findFirst({ where: { id: memberId }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '멤버를 찾을 수 없습니다.')

    if (ADMIN_ROLES.has(before.role as CrmRole)) {
      const others = await countAdmins(tx, memberId)
      if (others === 0) {
        throw new CrmError('VALIDATION_FAILED',
          '마지막 관리자예요. 다른 사람을 관리자로 올린 다음에 내보내 주세요.', { field: 'memberId' })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMember.updateMany({ where: { id: memberId }, data: { deletedAt: new Date() } })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'member.removed',
      targetType: 'member', targetId: memberId,
      beforeJson: { displayName: before.displayName, role: before.role },
    })
  })
}


/**
 * 프로필 수정 — 직위·연락처.
 *
 * **왜 필요한가**: 견적서의 담당자는 «견적을 만든 사람»인데(기획 결정 3),
 * 그 사람의 직위·연락처를 넣을 자리가 없었다. 그래서 회사 설정에
 * 고정 연락처를 두는 방식으로 메워 놨었고, 그러면 누가 만들었든 같은 번호가 찍힌다.
 *
 * **누가 고치나**: 본인 또는 관리자. 남의 연락처를 아무나 바꾸면 안 되고,
 * 관리자는 퇴사자 정리 같은 이유로 고쳐야 한다.
 */
export interface MemberProfileInput {
  title?: string | null
  phone?: string | null
}

export async function updateMemberProfile(
  workspaceId: string,
  actorId: string | null,
  memberId: string,
  input: MemberProfileInput,
): Promise<MemberRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmMember.findFirst({ where: { id: memberId }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '멤버를 찾을 수 없습니다.')

    const data: Record<string, unknown> = {}
    if (input.title !== undefined) data.title = normalizeText(input.title)
    if (input.phone !== undefined) data.phone = normalizeText(input.phone)
    if (Object.keys(data).length === 0) return before as MemberRow

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMember.updateMany({ where: { id: memberId }, data })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmMember.findFirst({ where: { id: memberId }, select: SELECT })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'member.profile_updated',
      targetType: 'member', targetId: memberId,
      beforeJson: { title: before.title, phone: before.phone },
      afterJson: { title: after.title, phone: after.phone },
    })
    return after as MemberRow
  })
}
