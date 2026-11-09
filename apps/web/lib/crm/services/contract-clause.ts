/**
 * 조항 라이브러리 — 쓰고, 승인하고, 기준으로 읽는 자리 (P0184 I05)
 *
 * **초안은 고치고 승인본은 안 고친다.** 승인본을 고치라고 하면 같은 키의 다음 번호 초안을
 * 새로 만든다. 승인본은 표준 이탈 판정(I08)의 기준이라, 그 글이 바뀌면 이미 판정한 계약의
 * 근거가 사라진다. DB 트리거(마이그 326)가 한 번 더 막는다.
 *
 * **승인은 관리자만, 판정은 여기서.** 창구가 ADMIN 을 요구해도 서비스가 역할을 다시 본다.
 * 창구가 하나 더 생겨 역할 확인을 빠뜨려도 승인은 열리지 않는다. 역할은 창구가 사람 확인 뒤
 * 연 문맥(runAsCrmViewer)에서 읽고, 문맥이 없으면 관리자가 아닌 것으로 센다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx, type TxCapableClient, type TxLike } from '../db/tx.ts'
import { writeAudit, type AuditCapableTx } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { currentCrmViewerRole } from '../domain/contract-sensitivity.ts'
import { hasCrmRole, type CrmRole } from '../auth/role.ts'
import { checkClauses } from './contract-template.ts'
import { CONTRACT_CLAUSE_MSG } from '../../terms/contract-doc.ts'

export const CLAUSE_LANGS = ['ko', 'en'] as const
export type ClauseLang = (typeof CLAUSE_LANGS)[number]
export const CLAUSE_STATUSES = ['DRAFT', 'APPROVED'] as const
export type ClauseStatus = (typeof CLAUSE_STATUSES)[number]

const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/

export interface ClauseRow {
  id: string
  key: string
  lang: ClauseLang
  versionNo: number
  title: string
  html: string
  status: ClauseStatus
  approvedById: string | null
  approvedAt: Date | null
  version: number
  updatedAt: Date
}

const SELECT = {
  id: true, key: true, lang: true, versionNo: true, title: true, html: true, status: true,
  approvedById: true, approvedAt: true, version: true, updatedAt: true,
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cl = (db: unknown): any => (db as any).crmContractClause
type Tx = TxLike & AuditCapableTx
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asTxClient = (db: CrmDb): TxCapableClient<Tx> => db as any

export interface ClauseInput {
  key?: unknown
  lang?: unknown
  title?: unknown
  html?: unknown
}

function pickKey(v: unknown): string {
  const key = typeof v === 'string' ? v.trim() : ''
  if (!KEY_PATTERN.test(key)) throw new CrmError('VALIDATION_FAILED', CONTRACT_CLAUSE_MSG.badKey, { field: 'key' })
  return key
}

function pickLang(v: unknown): ClauseLang {
  if (v === undefined || v === null || v === '') return 'ko'
  if (!CLAUSE_LANGS.includes(v as ClauseLang)) throw new CrmError('VALIDATION_FAILED', CONTRACT_CLAUSE_MSG.badLang, { field: 'lang' })
  return v as ClauseLang
}

/** 제목과 본문을 계약서 조항과 같은 정리기와 칸 검사에 통과시킨다 */
function cleanBody(title: unknown, html: unknown): { title: string; html: string } {
  const [c] = checkClauses([{ id: 'c1', title: typeof title === 'string' ? title : '', html: typeof html === 'string' ? html : '' }])
  if (!c.title) throw new CrmError('VALIDATION_FAILED', CONTRACT_CLAUSE_MSG.titleRequired, { field: 'title' })
  if (!c.html.replace(/<[^>]*>/g, '').trim()) throw new CrmError('VALIDATION_FAILED', CONTRACT_CLAUSE_MSG.bodyRequired, { field: 'html' })
  return { title: c.title, html: c.html }
}

export async function listClauses(db: CrmDb, filter: { status?: unknown; key?: unknown } = {}): Promise<ClauseRow[]> {
  const where: Record<string, unknown> = {}
  if (CLAUSE_STATUSES.includes(filter.status as ClauseStatus)) where.status = filter.status
  if (typeof filter.key === 'string' && KEY_PATTERN.test(filter.key)) where.key = filter.key
  return cl(db).findMany({ where, orderBy: [{ key: 'asc' }, { lang: 'asc' }, { versionNo: 'desc' }], select: SELECT })
}

export async function getClause(db: CrmDb, id: string): Promise<ClauseRow> {
  const row = await cl(db).findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', CONTRACT_CLAUSE_MSG.notFound)
  return row
}

/** 이 키의 가장 최근 승인본 — 표준 이탈 판정의 기준. 초안만 있으면 null (기준 없음) */
export async function approvedClause(db: CrmDb, key: string, lang: ClauseLang = 'ko'): Promise<ClauseRow | null> {
  return cl(db).findFirst({ where: { key, lang, status: 'APPROVED' }, orderBy: { versionNo: 'desc' }, select: SELECT })
}

/** 새 조항 — 버전 1 초안. 같은 키가 이미 있으면 거절한다 (새 버전은 고치기로 만든다) */
export async function createClause(db: CrmDb, workspaceId: string, actorId: string | null, input: ClauseInput): Promise<ClauseRow> {
  const key = pickKey(input.key)
  const lang = pickLang(input.lang)
  const body = cleanBody(input.title, input.html)
  return withCrmTx(workspaceId, async (tx) => {
    const taken = await cl(tx).findFirst({ where: { key, lang }, select: { id: true } })
    if (taken) throw new CrmError('CONFLICT', CONTRACT_CLAUSE_MSG.keyTaken, { field: 'key' })
    const row = await cl(tx).create({
      data: { key, lang, versionNo: 1, ...body, status: 'DRAFT', createdById: actorId },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_clause.created',
      targetType: 'contract_clause', targetId: row.id, afterJson: { key, lang, versionNo: 1 },
    })
    return row
  }, asTxClient(db))
}

/**
 * 고치기. 초안이면 그 자리를, 승인본이면 다음 번호 초안을 새로 만든다.
 * 같은 키에 이미 초안이 있으면 거절한다 — 초안이 둘이면 어느 쪽을 승인할지 모른다.
 */
export async function updateClause(
  db: CrmDb, workspaceId: string, actorId: string | null, id: string, version: number, input: ClauseInput,
): Promise<{ clause: ClauseRow; forked: boolean }> {
  return withCrmTx(workspaceId, async (tx) => {
    const cur = await cl(tx).findFirst({ where: { id }, select: SELECT }) as ClauseRow | null
    if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_CLAUSE_MSG.notFound)
    if (cur.version !== version) throw new CrmError('CONFLICT', CONTRACT_CLAUSE_MSG.conflict)
    const body = cleanBody(input.title ?? cur.title, input.html ?? cur.html)

    if (cur.status === 'DRAFT') {
      const n = await cl(tx).updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...body, version: { increment: 1 } } })
      if (n.count === 0) throw new CrmError('CONFLICT', CONTRACT_CLAUSE_MSG.conflict)
      await writeAudit(tx, {
        actorType: 'HUMAN', actorId, action: 'contract_clause.updated',
        targetType: 'contract_clause', targetId: id, afterJson: { key: cur.key, versionNo: cur.versionNo },
      })
      return { clause: await cl(tx).findFirst({ where: { id }, select: SELECT }), forked: false }
    }

    const draft = await cl(tx).findFirst({ where: { key: cur.key, lang: cur.lang, status: 'DRAFT' }, select: { id: true } })
    if (draft) throw new CrmError('CONFLICT', CONTRACT_CLAUSE_MSG.draftExists, { draftId: draft.id })
    const last = await cl(tx).findFirst({ where: { key: cur.key, lang: cur.lang }, orderBy: { versionNo: 'desc' }, select: { versionNo: true } })
    const versionNo = (last?.versionNo ?? cur.versionNo) + 1
    const row = await cl(tx).create({
      data: { key: cur.key, lang: cur.lang, versionNo, ...body, status: 'DRAFT', createdById: actorId },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_clause.forked',
      targetType: 'contract_clause', targetId: row.id, afterJson: { key: cur.key, from: cur.versionNo, versionNo },
    })
    return { clause: row, forked: true }
  }, asTxClient(db))
}

/** 승인 — 관리자만. 초안만 승인한다 */
export async function approveClause(
  db: CrmDb, workspaceId: string, actorId: string | null, id: string, version: number,
): Promise<ClauseRow> {
  const role = currentCrmViewerRole() as CrmRole | null
  if (!role || !hasCrmRole(role, 'ADMIN')) throw new CrmError('FORBIDDEN', CONTRACT_CLAUSE_MSG.approveDenied)
  return withCrmTx(workspaceId, async (tx) => {
    const cur = await cl(tx).findFirst({ where: { id }, select: SELECT }) as ClauseRow | null
    if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_CLAUSE_MSG.notFound)
    if (cur.status !== 'DRAFT') throw new CrmError('VALIDATION_FAILED', CONTRACT_CLAUSE_MSG.notDraft)
    if (cur.version !== version) throw new CrmError('CONFLICT', CONTRACT_CLAUSE_MSG.conflict)
    const n = await cl(tx).updateMany({
      where: { id, version, status: 'DRAFT' },
      data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date(), version: { increment: 1 } },
    })
    if (n.count === 0) throw new CrmError('CONFLICT', CONTRACT_CLAUSE_MSG.conflict)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_clause.approved',
      targetType: 'contract_clause', targetId: id, afterJson: { key: cur.key, lang: cur.lang, versionNo: cur.versionNo },
    })
    return cl(tx).findFirst({ where: { id }, select: SELECT })
  }, asTxClient(db))
}

/** 초안 지우기. 승인본은 기준이라 지우지 않는다 */
export async function deleteClauseDraft(db: CrmDb, workspaceId: string, actorId: string | null, id: string): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    const cur = await cl(tx).findFirst({ where: { id }, select: { status: true, key: true, versionNo: true } })
    if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_CLAUSE_MSG.notFound)
    if (cur.status !== 'DRAFT') throw new CrmError('VALIDATION_FAILED', CONTRACT_CLAUSE_MSG.notDraft)
    const n = await cl(tx).deleteMany({ where: { id, status: 'DRAFT' } })
    if (n.count === 0) throw new CrmError('NOT_FOUND', CONTRACT_CLAUSE_MSG.notFound)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_clause.deleted',
      targetType: 'contract_clause', targetId: id, afterJson: { key: cur.key, versionNo: cur.versionNo },
    })
  }, asTxClient(db))
}
