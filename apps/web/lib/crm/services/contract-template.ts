/**
 * 계약서 템플릿 — 쓰고, 발행하고, 고르는 자리 (P0132 I06)
 *
 * **작성 중과 발행이 다르다.** 고치는 동안의 본문은 템플릿 행의 `draftBody` 에 있고
 * 계약서 만들기는 그것을 안 읽는다. 「발행」을 눌러야 `crm_contract_template_version` 에
 * 다음 번호로 굳고, 그때부터 계약서 만들기가 그 버전을 쓴다. 굳은 버전은 DB 트리거가
 * 고치지 못하게 막는다(마이그 308) — 이미 만든 계약서가 가리키는 글이 바뀌지 않는다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText } from '../domain/normalize.ts'
import { normalizeClauses, ClauseInputError, type Clause } from '../domain/contract-body.ts'
import { scanTokens, fieldToken } from '../domain/contract-fields.ts'
import { CONTRACT_MSG } from '../../terms/contract-doc.ts'

export interface ContractTemplateRow {
  id: string
  name: string
  businessTypeKey: string | null
  isDefault: boolean
  position: number
  draftBody: Clause[] | null
  currentVersionNo: number | null
  version: number
  updatedAt: Date
}

const SELECT = {
  id: true, name: true, businessTypeKey: true, isDefault: true, position: true,
  draftBody: true, currentVersionNo: true, version: true, updatedAt: true,
} as const

/** 조항 목록을 검사하고, 모르는 칸이 있으면 이름을 대며 거절한다 */
export function checkClauses(input: unknown): Clause[] {
  let clauses: Clause[]
  try {
    clauses = normalizeClauses(input)
  } catch (e) {
    if (e instanceof ClauseInputError) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.badClauses(e.message))
    throw e
  }
  const unknown = clauses.flatMap((c) => scanTokens(`${c.title} ${c.html}`).unknown)
  if (unknown.length > 0) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.unknownFields([...new Set(unknown)].map(fieldToken).join(', ')), { field: 'draftBody' })
  }
  return clauses
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = (db: unknown): any => (db as any).crmContractTemplate
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tv = (db: unknown): any => (db as any).crmContractTemplateVersion

export async function listContractTemplates(db: CrmDb): Promise<ContractTemplateRow[]> {
  return t(db).findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: SELECT })
}

export async function getContractTemplate(db: CrmDb, id: string): Promise<ContractTemplateRow> {
  const row = await t(db).findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', CONTRACT_MSG.templateNotFound)
  return row
}

export interface TemplateVersionRow { versionNo: number; body: Clause[]; sourceFileName: string | null; createdAt: Date }

export async function listTemplateVersions(db: CrmDb, templateId: string): Promise<TemplateVersionRow[]> {
  return tv(db).findMany({
    where: { templateId }, orderBy: { versionNo: 'desc' },
    select: { versionNo: true, body: true, sourceFileName: true, createdAt: true },
  })
}

/** 계약서 만들기가 쓰는 버전 — 발행한 적 없으면 거절 */
export async function readPublishedTemplate(db: CrmDb, templateId: string): Promise<{ template: ContractTemplateRow; versionNo: number; body: Clause[] }> {
  const template = await getContractTemplate(db, templateId)
  if (!template.currentVersionNo) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.templateNotPublished)
  const v = await tv(db).findFirst({ where: { templateId, versionNo: template.currentVersionNo }, select: { body: true } })
  if (!v) throw new CrmError('NOT_FOUND', CONTRACT_MSG.templateNotFound)
  return { template, versionNo: template.currentVersionNo, body: v.body as Clause[] }
}

/** 이 사업 유형에 맞는 기본 템플릿 (없으면 모든 유형의 기본, 그것도 없으면 null) */
export async function defaultTemplateFor(db: CrmDb, businessTypeKey: string | null): Promise<ContractTemplateRow | null> {
  const all = (await listContractTemplates(db)).filter((x) => x.currentVersionNo)
  return all.find((x) => x.isDefault && x.businessTypeKey === businessTypeKey)
    ?? all.find((x) => x.isDefault && x.businessTypeKey === null)
    ?? null
}

export interface TemplateInput {
  name?: string | null
  businessTypeKey?: string | null
  isDefault?: boolean
  draftBody?: unknown
  /** 파일로 만든 경우 */
  sourceFileName?: string | null
  sourceAttachmentId?: string | null
}

export async function createContractTemplate(workspaceId: string, actorId: string | null, input: TemplateInput): Promise<ContractTemplateRow> {
  const name = normalizeText(input.name)
  if (!name) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.templateNameRequired, { field: 'name' })
  const draftBody = input.draftBody === undefined ? [] : checkClauses(input.draftBody)
  return withCrmTx(workspaceId, async (tx) => {
    const last = await t(tx).findFirst({ orderBy: { position: 'desc' }, select: { position: true } })
    const businessTypeKey = normalizeText(input.businessTypeKey)
    if (input.isDefault) await clearDefault(tx, businessTypeKey)
    const row = await t(tx).create({
      data: {
        name, businessTypeKey, isDefault: Boolean(input.isDefault), draftBody,
        position: (last?.position ?? -1) + 1, createdById: actorId,
      },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_template.created',
      targetType: 'contract_template', targetId: row.id, afterJson: { name, sourceFileName: input.sourceFileName ?? null },
    })
    return row
  })
}

async function clearDefault(tx: unknown, businessTypeKey: string | null, exceptId?: string): Promise<void> {
  await t(tx).updateMany({
    where: { businessTypeKey, isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    data: { isDefault: false },
  })
}

export async function updateContractTemplate(
  workspaceId: string, actorId: string | null, id: string, version: number, input: TemplateInput,
): Promise<ContractTemplateRow> {
  return withCrmTx(workspaceId, async (tx) => {
    const cur = await t(tx).findFirst({ where: { id }, select: { businessTypeKey: true, isDefault: true } })
    if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_MSG.templateNotFound)
    const data: Record<string, unknown> = {}
    if (input.name !== undefined) {
      const name = normalizeText(input.name)
      if (!name) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.templateNameRequired, { field: 'name' })
      data.name = name
    }
    if (input.businessTypeKey !== undefined) data.businessTypeKey = normalizeText(input.businessTypeKey)
    if (input.isDefault !== undefined) data.isDefault = Boolean(input.isDefault)
    if (input.draftBody !== undefined) data.draftBody = checkClauses(input.draftBody)
    const key = (data.businessTypeKey !== undefined ? data.businessTypeKey : cur.businessTypeKey) as string | null
    const willBeDefault = data.isDefault !== undefined ? data.isDefault : cur.isDefault
    if (willBeDefault) await clearDefault(tx, key, id)
    const n = await t(tx).updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } })
    if (n.count === 0) throw new CrmError('CONFLICT', CONTRACT_MSG.templateConflict)
    const row = await t(tx).findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_template.updated',
      targetType: 'contract_template', targetId: id,
      afterJson: { ...data, draftBody: data.draftBody ? `${(data.draftBody as Clause[]).length} clauses` : undefined },
    })
    return row
  })
}

/** 템플릿에 남긴 원본 파일 가운데 가장 최근 것. 없으면 null 두 칸 */
async function latestSource(tx: unknown, templateId: string): Promise<{ sourceFileName: string | null; sourceAttachmentId: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (tx as any).crmAttachment.findFirst({
    where: { targetType: 'CONTRACT_TEMPLATE', targetId: templateId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, fileName: true },
  })
  return { sourceFileName: row?.fileName ?? null, sourceAttachmentId: row?.id ?? null }
}

/** 작성 중 본문을 다음 버전으로 굳힌다 */
export async function publishContractTemplate(
  workspaceId: string, actorId: string | null, id: string, version: number,
  source?: { sourceFileName?: string | null; sourceAttachmentId?: string | null },
): Promise<ContractTemplateRow> {
  return withCrmTx(workspaceId, async (tx) => {
    const cur = await t(tx).findFirst({ where: { id }, select: { draftBody: true, currentVersionNo: true, version: true } })
    if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_MSG.templateNotFound)
    if (cur.version !== version) throw new CrmError('CONFLICT', CONTRACT_MSG.templateConflict)
    const body = checkClauses(cur.draftBody ?? [])
    if (body.length === 0) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.templateNoClauses)
    const versionNo = (cur.currentVersionNo ?? 0) + 1
    /*
      파일로 만든 템플릿이면 **원본 첨부를 버전에 적는다.** 부르는 쪽이 넘기지 않아도 서버가 찾는다 —
      발행 단추는 첨부 id 를 모르고, 알게 하면 화면이 고른 id 를 믿게 된다. 가장 최근에 올린 원본이 그 글의 출처다.
    */
    const src = source ?? await latestSource(tx, id)
    await tv(tx).create({
      data: {
        workspaceId, templateId: id, versionNo, body,
        sourceFileName: src.sourceFileName ?? null, sourceAttachmentId: src.sourceAttachmentId ?? null,
        createdById: actorId,
      },
    })
    const n = await t(tx).updateMany({ where: { id, version }, data: { currentVersionNo: versionNo, version: { increment: 1 } } })
    if (n.count === 0) throw new CrmError('CONFLICT', CONTRACT_MSG.templateConflict)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_template.published',
      targetType: 'contract_template', targetId: id, afterJson: { versionNo, clauses: body.length },
    })
    return t(tx).findFirst({ where: { id }, select: SELECT })
  })
}

/** 휴지통으로. 이미 만든 계약서는 굳은 버전을 들고 있어 영향이 없다 */
export async function deleteContractTemplate(workspaceId: string, actorId: string | null, id: string): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    const n = await t(tx).updateMany({ where: { id }, data: { deletedAt: new Date(), isDefault: false } })
    if (n.count === 0) throw new CrmError('NOT_FOUND', CONTRACT_MSG.templateNotFound)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract_template.deleted',
      targetType: 'contract_template', targetId: id,
    })
  })
}
