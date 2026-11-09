/**
 * 계약 모듈 — 조항 묶음과 켜는 조건을 관리하는 자리 (P0184 I11)
 *
 * **고치는 것은 관리자만, 판정은 여기서.** 모듈은 어떤 조항이 어느 계약에 들어가는지를 정한다.
 * 창구가 ADMIN 을 요구해도 서비스가 역할을 다시 본다. 조항 승인과 같은 이유다.
 *
 * **없는 조항 키는 거절한다.** 모듈은 조항 본문을 들지 않고 키만 든다. 오타 난 키를 받으면
 * 조립 때가 되어서야 「승인된 조항이 없다」고 터진다. 넣을 때 라이브러리에 있는지 본다.
 */

import { Prisma } from '@prisma/client'
import type { CrmDb } from '../db/client.ts'
import { withCrmTx, type TxCapableClient, type TxLike } from '../db/tx.ts'
import { writeAudit, type AuditCapableTx } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { currentCrmViewerRole } from '../domain/contract-sensitivity.ts'
import { hasCrmRole, type CrmRole } from '../auth/role.ts'
import {
  checkCondition, isModuleKind, ModuleInputError, type ModuleCondition, type ModuleKindOrCommon,
} from '../domain/contract-module.ts'
import { CONTRACT_MODULE_MSG } from '../../terms/contract-doc.ts'

const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/
export const MAX_MODULE_CLAUSES = 60
const MAX_TITLE = 120

export interface ModuleRow {
  id: string
  key: string
  kind: ModuleKindOrCommon
  title: string
  clauseKeys: string[]
  enableWhen: ModuleCondition | null
  isActive: boolean
  position: number
  version: number
  updatedAt: Date
}

const SELECT = {
  id: true, key: true, kind: true, title: true, clauseKeys: true, enableWhen: true,
  isActive: true, position: true, version: true, updatedAt: true,
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const md = (db: unknown): any => (db as any).crmContractModule
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cl = (db: unknown): any => (db as any).crmContractClause
type Tx = TxLike & AuditCapableTx
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asTxClient = (db: CrmDb): TxCapableClient<Tx> => db as any

export interface ModuleInput {
  key?: unknown
  kind?: unknown
  title?: unknown
  clauseKeys?: unknown
  enableWhen?: unknown
  isActive?: unknown
  position?: unknown
}

function requireAdmin(): void {
  const role = currentCrmViewerRole() as CrmRole | null
  if (!role || !hasCrmRole(role, 'ADMIN')) throw new CrmError('FORBIDDEN', CONTRACT_MODULE_MSG.editDenied)
}

function pickKey(v: unknown): string {
  const key = typeof v === 'string' ? v.trim() : ''
  if (!KEY_PATTERN.test(key)) throw new CrmError('VALIDATION_FAILED', CONTRACT_MODULE_MSG.badKey, { field: 'key' })
  return key
}

function pickKind(v: unknown): ModuleKindOrCommon {
  if (!isModuleKind(v)) throw new CrmError('VALIDATION_FAILED', CONTRACT_MODULE_MSG.badKind, { field: 'kind' })
  return v
}

function pickTitle(v: unknown): string {
  const title = typeof v === 'string' ? v.trim() : ''
  if (!title || title.length > MAX_TITLE) throw new CrmError('VALIDATION_FAILED', CONTRACT_MODULE_MSG.titleRequired, { field: 'title' })
  return title
}

function pickClauseKeys(v: unknown): string[] {
  if (!Array.isArray(v)) throw new CrmError('VALIDATION_FAILED', CONTRACT_MODULE_MSG.badClauseKeys, { field: 'clauseKeys' })
  const keys = v.map((k) => (typeof k === 'string' ? k.trim() : ''))
  if (keys.length > MAX_MODULE_CLAUSES || keys.some((k) => !KEY_PATTERN.test(k)) || new Set(keys).size !== keys.length) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_MODULE_MSG.badClauseKeys, { field: 'clauseKeys' })
  }
  return keys
}

function pickCondition(v: unknown): ModuleCondition | null {
  try {
    return checkCondition(v)
  } catch (e) {
    if (e instanceof ModuleInputError) throw new CrmError('VALIDATION_FAILED', e.message, { field: 'enableWhen' })
    throw e
  }
}

function pickPosition(v: unknown): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new CrmError('VALIDATION_FAILED', CONTRACT_MODULE_MSG.badPosition, { field: 'position' })
  return n
}

/** 라이브러리에 없는 조항 키가 있으면 거절한다 (상태는 묻지 않음, 초안도 넣을 수 있다) */
async function assertClausesExist(tx: unknown, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  const rows: { key: string }[] = await cl(tx).findMany({ where: { key: { in: [...keys] } }, select: { key: true } })
  const have = new Set(rows.map((r) => r.key))
  const missing = keys.filter((k) => !have.has(k))
  if (missing.length) throw new CrmError('VALIDATION_FAILED', CONTRACT_MODULE_MSG.unknownClauses(missing.join(', ')), { field: 'clauseKeys' })
}

export async function listModules(db: CrmDb, filter: { kind?: unknown } = {}): Promise<ModuleRow[]> {
  const where: Record<string, unknown> = {}
  if (isModuleKind(filter.kind)) where.kind = filter.kind
  return md(db).findMany({ where, orderBy: [{ kind: 'asc' }, { position: 'asc' }, { key: 'asc' }], select: SELECT })
}

export async function getModule(db: CrmDb, id: string): Promise<ModuleRow> {
  const row = await md(db).findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', CONTRACT_MODULE_MSG.notFound)
  return row
}

export async function createModule(db: CrmDb, workspaceId: string, actorId: string | null, input: ModuleInput): Promise<ModuleRow> {
  requireAdmin()
  const data = {
    key: pickKey(input.key),
    kind: pickKind(input.kind),
    title: pickTitle(input.title),
    clauseKeys: pickClauseKeys(input.clauseKeys ?? []),
    enableWhen: pickCondition(input.enableWhen),
    isActive: input.isActive === undefined ? true : input.isActive === true,
    position: input.position === undefined ? 0 : pickPosition(input.position),
  }
  return withCrmTx(workspaceId, async (tx) => {
    const taken = await md(tx).findFirst({ where: { key: data.key }, select: { id: true } })
    if (taken) throw new CrmError('CONFLICT', CONTRACT_MODULE_MSG.keyTaken, { field: 'key' })
    await assertClausesExist(tx, data.clauseKeys)
    const row = await md(tx).create({ data: { ...data, enableWhen: data.enableWhen ?? undefined, createdById: actorId }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_module.created',
      targetType: 'contract_module', targetId: row.id, afterJson: { key: data.key, kind: data.kind },
    })
    return row
  }, asTxClient(db))
}

/** 고치기. 키와 종류는 안 바꾼다 — 바꾸면 그 키로 고른 계약이 다른 모듈을 가리킨다 */
export async function updateModule(
  db: CrmDb, workspaceId: string, actorId: string | null, id: string, version: number, input: ModuleInput,
): Promise<ModuleRow> {
  requireAdmin()
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = pickTitle(input.title)
  if (input.clauseKeys !== undefined) patch.clauseKeys = pickClauseKeys(input.clauseKeys)
  // null 은 「조건 없음(고를 때만)」으로 되돌리는 값이라 따로 센다
  if (input.enableWhen !== undefined) patch.enableWhen = pickCondition(input.enableWhen)
  if (input.isActive !== undefined) patch.isActive = input.isActive === true
  if (input.position !== undefined) patch.position = pickPosition(input.position)
  return withCrmTx(workspaceId, async (tx) => {
    const cur = await md(tx).findFirst({ where: { id }, select: { key: true, version: true } })
    if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_MODULE_MSG.notFound)
    if (cur.version !== version) throw new CrmError('CONFLICT', CONTRACT_MODULE_MSG.conflict)
    if (patch.clauseKeys) await assertClausesExist(tx, patch.clauseKeys as string[])
    // Prisma Json? 칸은 null 을 DbNull 로 받아야 지워진다
    const enableWhen = 'enableWhen' in patch ? { enableWhen: patch.enableWhen ?? Prisma.DbNull } : {}
    const data = { ...patch, ...enableWhen, version: { increment: 1 } }
    const n = await md(tx).updateMany({ where: { id, version }, data })
    if (n.count === 0) throw new CrmError('CONFLICT', CONTRACT_MODULE_MSG.conflict)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_module.updated',
      targetType: 'contract_module', targetId: id, afterJson: { key: cur.key, fields: Object.keys(patch) },
    })
    return md(tx).findFirst({ where: { id }, select: SELECT })
  }, asTxClient(db))
}

export async function deleteModule(db: CrmDb, workspaceId: string, actorId: string | null, id: string): Promise<void> {
  requireAdmin()
  await withCrmTx(workspaceId, async (tx) => {
    const cur = await md(tx).findFirst({ where: { id }, select: { key: true } })
    if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_MODULE_MSG.notFound)
    const n = await md(tx).deleteMany({ where: { id } })
    if (n.count === 0) throw new CrmError('NOT_FOUND', CONTRACT_MODULE_MSG.notFound)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_module.deleted',
      targetType: 'contract_module', targetId: id, afterJson: { key: cur.key },
    })
  }, asTxClient(db))
}
