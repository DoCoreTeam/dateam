/**
 * 인물 서비스 (dacrm T1-02)
 *
 * 회사 서비스와 같은 규칙을 따른다 — 정규화·트랜잭션+감사·낙관적 잠금.
 * 공통 부품(cursor·optimistic·soft-delete)은 같은 것을 쓰고,
 * 엔티티 고유한 것(어떤 필드를 어떻게 정규화하는가)만 여기 있다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { loadMemberDisplays, toPersonJson } from './member-display.ts'
import { normalizeEmail, normalizePhone, normalizeText, requireText } from '../domain/normalize.ts'
import { assertUpdated, lockWhere, BUMP_VERSION } from '../db/optimistic.ts'
import {
  clampLimit, decodeCursor, cursorWhere, CURSOR_ORDER, toPage, countIfFirstPage,
  type CursorInput, type CursorPage,
} from '../db/cursor.ts'
import { planDelete, type DeleteMode } from '../domain/soft-delete.ts'

export interface PersonRow {
  id: string
  companyId: string | null
  name: string
  email: string | null
  phone: string | null
  title: string | null
  lifecycleStage: string
  memo: string | null
  ownerId: string | null
  /** 등록한 사람(CrmMember.id). 비어 있으면 기록이 없는 것이다 */
  createdById: string | null
  version: number
  updatedAt: Date
}

const SELECT = {
  id: true, companyId: true, name: true, email: true, phone: true, title: true,
  lifecycleStage: true, memo: true, ownerId: true, createdById: true, version: true, updatedAt: true,
} as const

export interface PersonInput {
  name: string
  companyId?: string | null
  email?: string | null
  phone?: string | null
  title?: string | null
  lifecycleStage?: string
  memo?: string | null
  ownerId?: string | null
}

function normalizeInput(input: PersonInput): Record<string, unknown> {
  const name = requireText(input.name)
  if (!name) throw new CrmError('VALIDATION_FAILED', '이름을 입력해 주세요.', { field: 'name' })

  const out: Record<string, unknown> = { name }
  if (input.companyId !== undefined) out.companyId = input.companyId || null
  if (input.email !== undefined) {
    const raw = (input.email ?? '').trim()
    const email = normalizeEmail(raw)
    // 값을 줬는데 형식이 아니면 조용히 버리지 않는다 — 사용자는 저장된 줄 안다
    if (raw && !email) {
      throw new CrmError('VALIDATION_FAILED', '이메일 형식이 올바르지 않습니다.', { field: 'email' })
    }
    out.email = email
  }
  if (input.phone !== undefined) out.phone = normalizePhone(input.phone)
  if (input.title !== undefined) out.title = normalizeText(input.title)
  if (input.lifecycleStage !== undefined) out.lifecycleStage = input.lifecycleStage
  if (input.memo !== undefined) out.memo = input.memo?.trim() || null
  if (input.ownerId !== undefined) out.ownerId = input.ownerId || null
  return out
}

export interface ListPersonInput extends CursorInput {
  /**
   * 휴지통만 본다.
   *
   * 왜 옵션인가: 가드가 기본으로 `deletedAt: null` 을 넣는다(그게 맞다).
   * 휴지통은 **일부러 삭제된 것을 보는 화면**이라, 그 기본을 명시적으로 뒤집는다.
   * 화면이 "30일 안에 되돌릴 수 있습니다"라고 약속했으면 되돌릴 길이 있어야 한다.
   */
  trash?: boolean
  q?: string | null
  companyId?: string | null
  /**
   * 담당자로 좁힌다. `undefined`/`null` 이면 안 좁힌다(전체).
   *
   * 목록의 기본은 **내 담당**이다 — 예전에는 어느 계정으로 들어와도 같은 목록이 나왔다
   * (사용자 지적 2026-09-22). 조건은 여기 한 곳에만 적는다, 목록과 합계가 어긋나지 않게.
   */
  ownerMemberIds?: readonly string[] | null
}

export async function listPeople(
  db: CrmDb,
  input: ListPersonInput = {},
): Promise<CursorPage<PersonRow>> {
  const limit = clampLimit(input.limit)
  const decoded = decodeCursor(input.cursor)
  const q = normalizeText(input.q)

  const where: Record<string, unknown> = {}
  if (input.trash) where.deletedAt = { not: null }
  if (input.companyId) where.companyId = input.companyId
  if (input.ownerMemberIds) where.ownerId = { in: [...input.ownerMemberIds] }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q.toLowerCase() } },
    ]
  }
  const cur = cursorWhere(decoded)
  const finalWhere = cur ? { AND: [where, cur] } : where

  const [rows, total] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmPerson.findMany({
      where: finalWhere, select: SELECT, orderBy: CURSOR_ORDER, take: limit + 1,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countIfFirstPage((db as any).crmPerson, where, decoded),
  ])
  /*
    사람 정보를 한 벌로 붙인다 — 목록·상세가 같은 부품으로 같은 값을 그리게 한다.
    딜 목록과 **같은 함수**를 쓴다. 자리마다 따로 읽으면 어떤 곳은 이름만, 어떤 곳은 직함까지가 된다.
  */
  const displays = await loadMemberDisplays(db)
  const withPeople = (rows as PersonRow[]).map((r) => ({
    ...r,
    owner: toPersonJson(r.ownerId, displays),
    creator: toPersonJson(r.createdById, displays),
  }))
  return toPage(withPeople as PersonRow[], limit, total)
}

export async function getPerson(db: CrmDb, id: string): Promise<PersonRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).crmPerson.findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', '인물을 찾을 수 없습니다.')
  return row as PersonRow
}

export async function createPerson(
  workspaceId: string,
  actorId: string | null,
  input: PersonInput,
): Promise<PersonRow> {
  const data = normalizeInput(input)
  /**
   * 등록한 사람과 담당자는 **만들 때만** 정해진다.
   *
   * 작성자는 이 줄에서만 들어가고 고치는 길에는 없다 — 바꿀 수 있으면 이력이 아니다.
   * 담당자 기본값은 등록한 사람이다. 비워 두면 「나중에 지정하지」가 되고,
   * 그 결과가 거래처 381건이 전부 빈 칸이던 상태다(실측 2026-09-22).
   * 만드는 쪽이 다른 사람을 넘겼으면 그 값이 이긴다.
   */
  data.createdById = actorId
  if (data.ownerId == null) data.ownerId = actorId

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmPerson.create({ data, select: SELECT })
    await writeAudit(tx, ({
      actorType: 'HUMAN', actorId, action: 'person.created', targetType: 'person', targetId: created.id, afterJson: created,
    }))
    return created as PersonRow
  })
}

export interface UpdatePersonInput extends Partial<PersonInput> {
  version: number
}

export async function updatePerson(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: UpdatePersonInput,
): Promise<PersonRow> {
  const { version, ...rest } = input
  const data = rest.name !== undefined
    ? normalizeInput(rest as PersonInput)
    : normalizeInput({ ...rest, name: '__keep__' } as PersonInput)
  if (rest.name === undefined) delete data.name

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmPerson.findFirst({ where: { id }, select: SELECT })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmPerson.updateMany({
      where: lockWhere(id, version), data: { ...data, ...BUMP_VERSION },
    })
    assertUpdated(res.count, { exists: Boolean(before), version: before?.version }, '인물')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmPerson.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, ({
      actorType: 'HUMAN', actorId, action: 'person.updated', targetType: 'person', targetId: id, beforeJson: before, afterJson: after,
    }))
    return after as PersonRow
  })
}

export async function deletePerson(
  workspaceId: string,
  actorId: string | null,
  id: string,
  mode: DeleteMode = 'trash',
): Promise<void> {
  const plan = planDelete(mode)

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmPerson.findFirst({
      where: mode === 'purge' ? { id, deletedAt: { not: undefined } } : { id },
      select: SELECT,
    })
    if (!before) throw new CrmError('NOT_FOUND', '인물을 찾을 수 없습니다.')

    if (mode === 'trash') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (tx as any).crmPerson.updateMany({
        where: { id }, data: { deletedAt: new Date(), ...BUMP_VERSION },
      })
      assertUpdated(res.count, { exists: true, version: before.version }, '인물')
    } else {
      // FK 없는 참조를 먼저 치운다 — 본체를 지우면 고아가 남는 자리
      await tx.crmAiSuggestion.deleteMany({ where: { targetType: 'person', targetId: id } })
      await tx.crmDuplicateCandidate.deleteMany({
        where: { targetType: 'person', OR: [{ aId: id }, { bId: id }] },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmPerson.deleteMany({ where: { id } })
    }

    await writeAudit(tx, ({
      actorType: 'HUMAN', actorId, action: plan.auditAction, targetType: 'person', targetId: id, beforeJson: before,
    }))
  })
}

export async function restorePerson(
  workspaceId: string,
  actorId: string | null,
  id: string,
): Promise<PersonRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmPerson.updateMany({
      where: { id, deletedAt: { not: null } }, data: { deletedAt: null, ...BUMP_VERSION },
    })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '휴지통에서 인물을 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmPerson.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, ({
      actorType: 'HUMAN', actorId, action: 'person.restored', targetType: 'person', targetId: id, afterJson: after,
    }))
    return after as PersonRow
  })
}
