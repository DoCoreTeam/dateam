/**
 * 태스크 서비스 (dacrm T1-04)
 *
 * 회사·인물·딜과 다른 점 둘.
 *
 *   1) **버전 컬럼이 없다.** 스키마가 그렇게 정해져 있다(crm_task 에 version 없음).
 *      태스크는 한 사람이 자기 할 일을 다루는 물건이라 동시 수정 충돌이 드물고,
 *      충돌해도 잃는 것이 "제목 한 줄"이다. 그래서 낙관적 잠금을 걸지 않는다.
 *      대신 **완료 시각은 서버가 찍는다** — 클라이언트 시계를 믿으면 순서가 뒤집힌다.
 *
 *   2) **완료하면 활동이 하나 남는다.** 태스크는 사라지는 물건이 아니라
 *      "그때 이 회사에 무슨 일이 있었나"의 재료다. 완료를 지우면 타임라인에 구멍이 난다.
 *      활동 기록이 실패하면 완료도 없던 일이 된다(같은 트랜잭션) — 둘이 어긋나면
 *      "완료했는데 기록이 없다"가 되고, 그건 나중에 아무도 설명할 수 없다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText, requireText } from '../domain/normalize.ts'
import {
  clampLimit, decodeCursor, cursorWhere, CURSOR_ORDER, toPage,
  type CursorInput, type CursorPage,
} from '../db/cursor.ts'
import { planDelete, type DeleteMode } from '../domain/soft-delete.ts'

export type TaskStatus = 'TODO' | 'DOING' | 'DONE' | 'CANCELED'

const STATUSES: ReadonlySet<string> = new Set(['TODO', 'DOING', 'DONE', 'CANCELED'])

/** 끝난 것 — 목록에서 "열린 태스크"를 가를 때 이 집합이 기준이다 */
export const CLOSED_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['DONE', 'CANCELED'])

export interface TaskRow {
  id: string
  title: string
  status: string
  dueAt: Date | null
  assigneeId: string | null
  companyId: string | null
  personId: string | null
  dealId: string | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true, title: true, status: true, dueAt: true, assigneeId: true,
  companyId: true, personId: true, dealId: true, completedAt: true,
  createdAt: true, updatedAt: true,
} as const

export interface TaskInput {
  title: string
  status?: string | null
  dueAt?: string | null
  assigneeId?: string | null
  companyId?: string | null
  personId?: string | null
  dealId?: string | null
}

function normalizeStatus(v: string | null | undefined): TaskStatus | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const s = String(v).trim().toUpperCase()
  if (!STATUSES.has(s)) {
    throw new CrmError('VALIDATION_FAILED', '알 수 없는 상태입니다.', { field: 'status' })
  }
  return s as TaskStatus
}

function normalizeInput(input: Partial<TaskInput>, requireTitle: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (requireTitle || input.title !== undefined) {
    const title = requireText(input.title)
    if (!title) throw new CrmError('VALIDATION_FAILED', '할 일 제목을 입력해 주세요.', { field: 'title' })
    out.title = title
  }
  const status = normalizeStatus(input.status)
  if (status) out.status = status
  if (input.dueAt !== undefined) out.dueAt = input.dueAt ? new Date(input.dueAt) : null
  for (const k of ['assigneeId', 'companyId', 'personId', 'dealId'] as const) {
    if (input[k] !== undefined) out[k] = normalizeText(input[k]) ?? null
  }
  return out
}

export interface ListTaskInput extends CursorInput {
  q?: string | null
  companyId?: string | null
  personId?: string | null
  dealId?: string | null
  /** 'open' 이면 끝나지 않은 것만 — 레코드 상세의 "열린 태스크"가 쓴다 */
  scope?: 'open' | 'all' | null
  status?: string | null
  trash?: boolean
}

export async function listTasks(db: CrmDb, input: ListTaskInput = {}): Promise<CursorPage<TaskRow>> {
  const limit = clampLimit(input.limit)
  const decoded = decodeCursor(input.cursor)
  const q = normalizeText(input.q)

  const where: Record<string, unknown> = {}
  if (input.trash) where.deletedAt = { not: null }
  if (input.companyId) where.companyId = input.companyId
  if (input.personId) where.personId = input.personId
  if (input.dealId) where.dealId = input.dealId
  if (input.status) where.status = normalizeStatus(input.status)
  else if (input.scope === 'open') where.status = { in: ['TODO', 'DOING'] }
  if (q) where.title = { contains: q, mode: 'insensitive' }

  const cur = cursorWhere(decoded)
  const finalWhere = cur ? { AND: [where, cur] } : where

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmTask.findMany({
    where: finalWhere, select: SELECT, orderBy: CURSOR_ORDER, take: limit + 1,
  })
  return toPage(rows as TaskRow[], limit)
}

export async function getTask(db: CrmDb, id: string): Promise<TaskRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).crmTask.findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', '할 일을 찾을 수 없습니다.')
  return row as TaskRow
}

/**
 * 태스크가 가리키는 레코드를 활동에도 그대로 붙인다.
 *
 * 왜: 활동은 "이 회사/이 딜에 무슨 일이 있었나"로 읽힌다.
 * 태스크가 딜에만 붙어 있으면 회사 타임라인에서는 그 일이 없던 일이 된다.
 */
function scopeOf(task: TaskRow): Record<string, string | null> {
  return { companyId: task.companyId, personId: task.personId, dealId: task.dealId }
}

export async function createTask(
  workspaceId: string,
  actorId: string | null,
  input: TaskInput,
): Promise<TaskRow> {
  const data = normalizeInput(input, true)
  data.createdById = actorId

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmTask.create({ data, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'task.created',
      targetType: 'task', targetId: created.id, afterJson: created,
    })
    return created as TaskRow
  })
}

export interface UpdateTaskInput extends Partial<TaskInput> {
  /** 완료 시각은 서버가 찍는다 — 클라이언트가 보낸 값은 받지 않는다 */
  status?: string | null
}

export async function updateTask(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: UpdateTaskInput,
): Promise<TaskRow> {
  const data = normalizeInput(input, false)
  const nextStatus = data.status as TaskStatus | undefined

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmTask.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '할 일을 찾을 수 없습니다.')

    const now = new Date()
    const wasDone = before.status === 'DONE'
    const becomesDone = nextStatus === 'DONE' && !wasDone

    // 완료 시각은 상태를 따라간다 — 되돌리면 지운다(완료 안 했는데 완료일이 남으면 거짓이다)
    if (nextStatus === 'DONE') data.completedAt = wasDone ? before.completedAt : now
    else if (nextStatus !== undefined) data.completedAt = null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmTask.updateMany({ where: { id }, data })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '할 일을 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmTask.findFirst({ where: { id }, select: SELECT })

    // 완료는 타임라인에 남는다 — 같은 트랜잭션이라 하나가 실패하면 둘 다 없던 일이 된다
    if (becomesDone) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmActivity.create({
        data: {
          type: 'SYSTEM', occurredAt: now,
          title: `할 일 완료: ${after.title}`,
          source: 'HUMAN', createdById: actorId,
          ...scopeOf(after as TaskRow),
        },
      })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: becomesDone ? 'task.completed' : 'task.updated',
      targetType: 'task', targetId: id, beforeJson: before, afterJson: after,
    })
    return after as TaskRow
  })
}

export async function deleteTask(
  workspaceId: string,
  actorId: string | null,
  id: string,
  mode: DeleteMode = 'trash',
): Promise<void> {
  const plan = planDelete(mode)

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmTask.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '할 일을 찾을 수 없습니다.')

    if (plan.mode === 'purge') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmTask.deleteMany({ where: { id } })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmTask.updateMany({ where: { id }, data: { deletedAt: new Date() } })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: plan.auditAction,
      targetType: 'task', targetId: id, beforeJson: before,
    })
  })
}

/** 휴지통에서 되살린다 */
export async function restoreTask(
  workspaceId: string,
  actorId: string | null,
  id: string,
): Promise<TaskRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmTask.updateMany({
      where: { id, deletedAt: { not: null } }, data: { deletedAt: null },
    })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '휴지통에서 할 일을 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmTask.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'task.restored',
      targetType: 'task', targetId: id, afterJson: after,
    })
    return after as TaskRow
  })
}
