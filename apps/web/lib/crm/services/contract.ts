/**
 * 계약서 — 만들고, 고치고, 버전을 견준다 (P0132 I08)
 *
 * **버전은 한 번 쓰면 고치지 않는다. 고치면 다음 버전이다.** DB 트리거가 UPDATE 를 막는다(마이그 308).
 *
 * 버전 하나가 드는 것
 *   - 본문: 템플릿 조항 그대로, **칸 자리({{고객.상호}})를 남긴 채** 저장한다
 *   - 칸 값: 자동(견적에서 옴)과 사람이 넣은 값, 출처를 함께
 *   - 견적 스냅샷: 만든 날의 견적 문서 통째. 그 뒤 견적을 고쳐도 이 버전은 안 바뀐다
 *   - 서명란 설정: 그날 값
 *
 * 왜 칸 자리를 남기나: 견적이 바뀌어 다시 채울 때(I11) 자동 칸만 바꾸고 사람이 고친 칸은
 * 남겨야 한다. 글자로 채워 저장하면 어디가 칸이었는지 잊어버린다. 종이에 그릴 때 채운다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText } from '../domain/normalize.ts'
import { contentHash, diffClauses, diffFields, type Clause, type ClauseDiff } from '../domain/contract-body.ts'
import {
  CONTRACT_FIELDS, autoValuesFrom, mergeFieldValues, fillHtml, fieldByKey, type FieldValues,
} from '../domain/contract-fields.ts'
import { canAmend, canContractFromQuote, canWriteVersion, type ContractVersionKind } from '../domain/contract-status.ts'
import { DEFAULT_CONTRACT_NO_PATTERN, renderQuoteNo, seqOf, seqPrefix, validateQuoteNoPattern } from '../domain/quote-number.ts'
import type { QuoteDocument } from '../domain/quote-document.ts'
import { getQuote } from './quote.ts'
import { getQuoteDocument } from './quote-document.ts'
import { checkClauses, defaultTemplateFor, readPublishedTemplate } from './contract-template.ts'
import { resolveSetting, settingDef } from './setting.ts'
import { kstTodayKey } from '../../datetime/kst.ts'
import { CONTRACT_DOC, CONTRACT_MSG, CONTRACT_SIGN } from '../../terms/contract-doc.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const c = (db: unknown): any => (db as any).crmContract
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cv = (db: unknown): any => (db as any).crmContractVersion

/** 사람이 넣는 칸 값 하나의 길이 상한 */
const MAX_FIELD_VALUE = 500
const MAX_TITLE = 200
const MAX_NOTE = 1000

// ------------------------------------------------------------
// 설정 — 계약서 만들기가 읽고 버전에 굳힌다
// ------------------------------------------------------------

export interface ContractSignatureSetting {
  partyA: string
  partyB: string
  mark: 'seal' | 'sign' | 'either'
  showCeo: boolean
}

/** 계약서 서명란 설정 — 계약서 버전에 그때 값으로 굳는다 */
export async function readContractSignature(db: CrmDb): Promise<ContractSignatureSetting> {
  const [a, b, mark, showCeo] = await Promise.all([
    resolveSetting(db, 'contract.sign.partyA'),
    resolveSetting(db, 'contract.sign.partyB'),
    resolveSetting(db, 'contract.sign.mark'),
    resolveSetting(db, 'contract.sign.showCeo'),
  ])
  const m = String(mark.value)
  return {
    partyA: String(a.value || settingDef('contract.sign.partyA').fallback).slice(0, 20),
    partyB: String(b.value || settingDef('contract.sign.partyB').fallback).slice(0, 20),
    mark: m === 'sign' || m === 'either' ? m : 'seal',
    showCeo: String(showCeo.value) !== 'blank',
  }
}

/** 계약서 번호 형식 — 틀린 형식이 저장돼 있으면 기본값으로 */
export async function readContractNoPattern(db: CrmDb): Promise<string> {
  const raw = String((await resolveSetting(db, 'contract.numberFormat')).value ?? '')
  return raw && validateQuoteNoPattern(raw) === null ? raw : DEFAULT_CONTRACT_NO_PATTERN
}

/** 다음 계약서 번호 — 견적 번호와 같은 셈(삭제된 것도 쓴 번호다) */
async function nextContractNo(tx: unknown, pattern: string, todayKey: string): Promise<string> {
  const prefix = seqPrefix(pattern, todayKey)
  const last = await c(tx).findFirst({
    where: { ...(prefix ? { contractNo: { startsWith: prefix } } : {}), deletedAt: undefined },
    orderBy: { contractNo: 'desc' },
    select: { contractNo: true },
  })
  return renderQuoteNo(pattern, todayKey, seqOf(last?.contractNo, prefix) + 1)
}

// ------------------------------------------------------------
// 순수 판정 — 시험이 DB 없이 단정한다
// ------------------------------------------------------------

/** 보냄 또는 수락이고 유효기간 안인 견적만 계약서가 된다 */
export function assertContractableQuote(quote: { status: string; expired?: boolean }): void {
  if (!canContractFromQuote(quote.status)) throw new CrmError('INVALID_TRANSITION', CONTRACT_MSG.quoteNotContractable)
  if (quote.status === 'SENT' && quote.expired) throw new CrmError('INVALID_TRANSITION', CONTRACT_MSG.quoteExpired)
}

/** 사람이 넣는 칸 — 모르는 칸, 블록 칸, 계약서 번호는 거절한다 */
export function checkManualFields(input: unknown): Record<string, string> {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.badField('manual'))
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const def = fieldByKey(key)
    if (!def || def.kind === 'block' || key === 'contract.no') throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.badField(key), { field: key })
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value.length > MAX_FIELD_VALUE) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.fieldTooLong(def.label), { field: key })
    out[key] = value
  }
  return out
}

/** 버전에 든 칸 값에서 사람이 넣은 것만 꺼낸다 */
export function manualOf(values: FieldValues): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.source === 'manual').map(([k, v]) => [k, v.value]))
}

/**
 * 고친 칸 값. **빈 값을 보내면 그 칸은 자동으로 돌아간다** — 사람이 넣은 값을 지우는 길이다.
 * 보내지 않은 칸은 이전 버전 그대로다.
 */
export function nextFieldValues(prev: FieldValues, auto: Record<string, string>, patch: Record<string, string>): FieldValues {
  const manual = { ...manualOf(prev) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === '') delete manual[k]
    else manual[k] = v
  }
  return mergeFieldValues(auto, manual)
}

/** 종이에 그리는 조항 — 칸 자리를 값으로 채운다. 저장 본문은 칸 자리를 그대로 둔다 */
export function renderClauses(body: readonly Clause[], values: FieldValues, doc: QuoteDocument | null): Clause[] {
  return body.map((cl) => ({ ...cl, title: fillHtml(cl.title, values, doc), html: fillHtml(cl.html, values, doc) }))
}

/** 날짜 칸 값을 DB 날짜로. 형식이 아니면 null (목록 표시용이라 원본은 칸 값이다) */
function dateOrNull(v: string | undefined): Date | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null
}

function cleanTitle(raw: unknown, fallback: string): string {
  const t = normalizeText(typeof raw === 'string' ? raw : null) ?? fallback
  if (!t) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.titleRequired, { field: 'title' })
  return t.slice(0, MAX_TITLE)
}

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: string }).code === 'P2002')
}

// ------------------------------------------------------------
// 읽기
// ------------------------------------------------------------

export interface ContractRow {
  id: string
  dealId: string
  quoteId: string | null
  contractNo: string
  title: string
  status: string
  templateId: string | null
  parentContractId: string | null
  currentVersionNo: number
  sentAt: Date | null
  sentVersionNo: number | null
  concludedAt: Date | null
  totalMinor: string | null
  currency: string | null
  version: number
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true, dealId: true, quoteId: true, contractNo: true, title: true, status: true, templateId: true, parentContractId: true,
  currentVersionNo: true, sentAt: true, sentVersionNo: true, concludedAt: true, totalMinor: true, currency: true,
  version: true, createdAt: true, updatedAt: true,
} as const

export interface ContractVersionRow {
  versionNo: number
  kind: ContractVersionKind
  body: Clause[]
  fieldValues: FieldValues
  quoteSnapshot: QuoteDocument | null
  signatureSnapshot: ContractSignatureSetting | null
  templateVersionNo: number | null
  sourceQuoteId: string | null
  sourceQuoteVersion: number | null
  contentHash: string
  note: string | null
  createdById: string | null
  createdAt: Date
}

const VERSION_SELECT = {
  versionNo: true, kind: true, body: true, fieldValues: true, quoteSnapshot: true, signatureSnapshot: true,
  templateVersionNo: true, sourceQuoteId: true, sourceQuoteVersion: true, contentHash: true, note: true,
  createdById: true, createdAt: true,
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toRow = (r: any): ContractRow => ({ ...r, totalMinor: r.totalMinor === null || r.totalMinor === undefined ? null : String(r.totalMinor) })

export async function listDealContracts(db: CrmDb, dealId: string): Promise<ContractRow[]> {
  const rows = await c(db).findMany({ where: { dealId }, orderBy: { createdAt: 'desc' }, select: SELECT })
  return rows.map(toRow)
}

export async function findContract(db: unknown, id: string): Promise<ContractRow> {
  const row = await c(db).findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', CONTRACT_MSG.notFound)
  return toRow(row)
}

export async function getContractVersion(db: CrmDb, contractId: string, versionNo: number): Promise<ContractVersionRow> {
  await findContract(db, contractId)
  const v = await cv(db).findFirst({ where: { contractId, versionNo }, select: VERSION_SELECT })
  if (!v) throw new CrmError('NOT_FOUND', CONTRACT_MSG.versionNotFound)
  return v
}

/** 계약서와 지금 버전, 그리고 칸을 채운 종이 본문 */
export async function getContract(db: CrmDb, id: string): Promise<{ contract: ContractRow; current: ContractVersionRow; rendered: Clause[] }> {
  const contract = await findContract(db, id)
  const current = await getContractVersion(db, id, contract.currentVersionNo)
  return { contract, current, rendered: renderClauses(current.body, current.fieldValues, current.quoteSnapshot) }
}

export async function listContractVersions(db: CrmDb, contractId: string): Promise<Omit<ContractVersionRow, 'body' | 'fieldValues' | 'quoteSnapshot' | 'signatureSnapshot'>[]> {
  await findContract(db, contractId)
  return cv(db).findMany({
    where: { contractId }, orderBy: { versionNo: 'desc' },
    select: {
      versionNo: true, kind: true, templateVersionNo: true, sourceQuoteId: true, sourceQuoteVersion: true,
      contentHash: true, note: true, createdById: true, createdAt: true,
    },
  })
}

export interface ContractCompare {
  a: number
  b: number
  clauses: ClauseDiff[]
  fields: ReturnType<typeof diffFields>
}

/** 두 버전 비교 — 조항 차이와 칸 값 차이를 따로 */
export async function compareContractVersions(db: CrmDb, contractId: string, a: number, b: number): Promise<ContractCompare> {
  const [va, vb] = await Promise.all([getContractVersion(db, contractId, a), getContractVersion(db, contractId, b)])
  return { a, b, clauses: diffClauses(va.body, vb.body), fields: diffFields(va.fieldValues, vb.fieldValues) }
}

// ------------------------------------------------------------
// 만들기
// ------------------------------------------------------------

export interface CreateContractInput {
  quoteId?: string
  templateId?: string | null
  title?: string | null
  manual?: unknown
}

/**
 * 견적으로 계약서를 만든다.
 *
 * 견적은 `db`(워크스페이스 가드가 걸린 연결)로 읽는다 — 다른 워크스페이스의 견적 id 를 보내면
 * 가드가 그 행을 못 보게 해 「견적을 찾을 수 없습니다」가 된다.
 */
export async function createContractFromQuote(
  db: CrmDb, workspaceId: string, actorId: string | null, input: CreateContractInput,
): Promise<{ contract: ContractRow; versionNo: number }> {
  const quoteId = typeof input.quoteId === 'string' ? input.quoteId : ''
  if (!quoteId) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.quoteNotContractable, { field: 'quoteId' })
  const quote = await getQuote(db, quoteId)
  assertContractableQuote(quote as { status: string; expired?: boolean })
  const manual = checkManualFields(input.manual)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal = await (db as any).crmDeal.findFirst({ where: { id: quote.dealId }, select: { businessTypeKey: true } })
  const templateId = typeof input.templateId === 'string' && input.templateId
    ? input.templateId
    : (await defaultTemplateFor(db, deal?.businessTypeKey ?? null))?.id
  if (!templateId) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.noTemplate, { field: 'templateId' })

  const [{ versionNo: templateVersionNo, body: templateBody }, docResult, signature, pattern] = await Promise.all([
    readPublishedTemplate(db, templateId),
    getQuoteDocument(db, quoteId),
    readContractSignature(db),
    readContractNoPattern(db),
  ])
  const doc = docResult.document
  // 본문은 정리기를 한 번 더 지난다 — 발행본이라도 저장 전에 같은 문을 지난다(보안 S4)
  const body = checkClauses(templateBody)
  if (body.length === 0) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.noClauses)
  const title = cleanTitle(input.title, `${doc.meta.title || doc.customer.companyName} ${CONTRACT_DOC.entity}`)

  const attempt = () => withCrmTx(workspaceId, async (tx) => {
    const contractNo = await nextContractNo(tx, pattern, kstTodayKey())
    const fieldValues = mergeFieldValues(autoValuesFrom(doc, contractNo), manual)
    const created = await c(tx).create({
      data: {
        workspaceId, dealId: quote.dealId, quoteId, contractNo, title, templateId,
        currentVersionNo: 1,
        totalMinor: BigInt(doc.totals.totalMinor), currency: doc.meta.currency,
        effectiveFrom: dateOrNull(fieldValues['contract.start']?.value),
        effectiveTo: dateOrNull(fieldValues['contract.end']?.value),
        createdById: actorId,
      },
      select: SELECT,
    })
    await cv(tx).create({
      data: {
        workspaceId, contractId: created.id, versionNo: 1, kind: 'GENERATED' satisfies ContractVersionKind,
        body, fieldValues, quoteSnapshot: doc, supplierSnapshot: doc.supplier,
        customerSnapshot: { ...doc.customer, ...pickCustomer(fieldValues) },
        signatureSnapshot: signature, templateVersionNo,
        sourceQuoteId: quoteId, sourceQuoteVersion: quote.version,
        contentHash: contentHash(body, fieldValues), createdById: actorId,
      },
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract.created', targetType: 'contract', targetId: created.id,
      afterJson: { contractNo, quoteId, quoteVersion: quote.version, templateId, templateVersionNo },
    })
    return { contract: toRow(created), versionNo: 1 }
  })

  try {
    return await attempt()
  } catch (e) {
    // 같은 번호를 동시에 집었다 — 트랜잭션을 새로 열어 한 번만 다시 시도한다
    if (!isUniqueViolation(e)) throw e
    try { return await attempt() } catch (e2) {
      if (isUniqueViolation(e2)) throw new CrmError('CONFLICT', CONTRACT_MSG.numberTaken)
      throw e2
    }
  }
}

function pickCustomer(values: FieldValues): Record<string, string> {
  return Object.fromEntries(
    CONTRACT_FIELDS.filter((f) => f.source === 'customer').map((f) => [f.key, values[f.key]?.value ?? '']),
  )
}

// ------------------------------------------------------------
// 고치기 — 다음 버전
// ------------------------------------------------------------

export type SavePlan =
  | { action: 'noop' }
  | { action: 'title' | 'version'; body: Clause[]; fieldValues: FieldValues; hash: string; title: string }

/**
 * 저장 판정 — 무엇을 쓸지 DB 없이 정한다.
 *
 * 견적을 다시 읽지 않는다. 자동 칸 값은 **이 버전이 든 견적 스냅샷**에서 다시 만든다 —
 * 견적을 그 뒤에 고쳤어도 손으로 고친 저장이 새 견적 값을 몰래 끌고 오지 않는다(그것은 I11 다시 채우기).
 */
export function planSave(
  contract: Pick<ContractRow, 'status' | 'version' | 'title' | 'contractNo'>,
  cur: Pick<ContractVersionRow, 'body' | 'fieldValues' | 'quoteSnapshot' | 'contentHash'>,
  version: number,
  input: { body: Clause[] | null; patch: Record<string, string>; title?: string | null },
): SavePlan {
  if (!canWriteVersion(contract.status)) throw new CrmError('INVALID_TRANSITION', CONTRACT_MSG.notWritable)
  if (contract.version !== version) throw new CrmError('CONFLICT', CONTRACT_MSG.conflict)
  const body = input.body ?? cur.body
  const auto = cur.quoteSnapshot ? autoValuesFrom(cur.quoteSnapshot, contract.contractNo) : {}
  const fieldValues = Object.keys(input.patch).length > 0 ? nextFieldValues(cur.fieldValues, auto, input.patch) : cur.fieldValues
  const hash = contentHash(body, fieldValues)
  const title = input.title === undefined ? contract.title : cleanTitle(input.title, contract.title)
  if (hash !== cur.contentHash) return { action: 'version', body, fieldValues, hash, title }
  if (title !== contract.title) return { action: 'title', body, fieldValues, hash, title }
  return { action: 'noop' }
}

export interface SaveContractInput {
  body?: unknown
  manual?: unknown
  title?: string | null
  note?: string | null
}

/**
 * 고친 내용을 다음 버전으로 남긴다.
 *
 * - 작성 중일 때만 쓴다. 체결한 글은 그날 날인한 글이다
 * - `version` 이 지금과 다르면 CONFLICT — 남이 먼저 고친 것을 덮지 않는다
 * - 본문과 칸 값이 지금 버전과 같으면(지문이 같으면) 버전을 만들지 않는다
 */
export async function saveContractVersion(
  workspaceId: string, actorId: string | null, id: string, version: number, input: SaveContractInput,
  kind: ContractVersionKind = 'EDITED',
): Promise<{ contract: ContractRow; versionNo: number; created: boolean }> {
  const patch = checkManualFields(input.manual)
  const nextBody = input.body === undefined ? null : checkClauses(input.body)
  if (nextBody && nextBody.length === 0) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.noClauses)
  const note = normalizeText(input.note)?.slice(0, MAX_NOTE) ?? null

  return withCrmTx(workspaceId, async (tx) => {
    const contract = await findContract(tx, id)
    const cur: ContractVersionRow | null = await cv(tx).findFirst({
      where: { contractId: id, versionNo: contract.currentVersionNo }, select: VERSION_SELECT,
    })
    if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_MSG.versionNotFound)
    const plan = planSave(contract, cur, version, { body: nextBody, patch, title: input.title })
    if (plan.action === 'noop') return { contract, versionNo: cur.versionNo, created: false }
    const { body, fieldValues, hash, title } = plan

    let versionNo = cur.versionNo
    if (plan.action === 'version') {
      versionNo = cur.versionNo + 1
      await cv(tx).create({
        data: {
          workspaceId, contractId: id, versionNo, kind, body, fieldValues,
          quoteSnapshot: cur.quoteSnapshot ?? undefined,
          supplierSnapshot: cur.quoteSnapshot?.supplier ?? undefined,
          customerSnapshot: cur.quoteSnapshot ? { ...cur.quoteSnapshot.customer, ...pickCustomer(fieldValues) } : undefined,
          signatureSnapshot: cur.signatureSnapshot ?? undefined,
          templateVersionNo: cur.templateVersionNo,
          sourceQuoteId: cur.sourceQuoteId, sourceQuoteVersion: cur.sourceQuoteVersion,
          contentHash: hash, note, createdById: actorId,
        },
      })
    }
    const n = await c(tx).updateMany({
      where: { id, version },
      data: {
        currentVersionNo: versionNo, title,
        effectiveFrom: dateOrNull(fieldValues['contract.start']?.value),
        effectiveTo: dateOrNull(fieldValues['contract.end']?.value),
        version: { increment: 1 },
      },
    })
    if (n.count === 0) throw new CrmError('CONFLICT', CONTRACT_MSG.conflict)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract.version_saved', targetType: 'contract', targetId: id,
      afterJson: { versionNo, kind, note, titleChanged: title !== contract.title },
    })
    return { contract: await findContract(tx, id), versionNo, created: versionNo !== cur.versionNo }
  })
}

// ------------------------------------------------------------
// 변경 계약서 — 체결한 계약을 바꾸는 유일한 길 (I10)
// ------------------------------------------------------------

/**
 * 체결한 계약서에서 변경 계약서를 만든다. 원 계약은 그대로 체결 상태로 남고,
 * 새 계약서가 `parentContractId` 로 원 계약을 가리킨다.
 *
 * 본문과 사람이 넣은 칸은 원 계약의 지금 버전을 잇는다. 계약서 번호는 새로 받고,
 * 자동 칸은 원 계약이 든 견적 스냅샷과 새 번호로 다시 만든다 — 옛 번호가 새 계약서에 찍히지 않게.
 */
export async function createAmendment(
  db: CrmDb, workspaceId: string, actorId: string | null, id: string,
): Promise<{ contract: ContractRow; versionNo: number }> {
  const pattern = await readContractNoPattern(db)
  try {
    return await withCrmTx(workspaceId, async (tx) => {
      const parent = await findContract(tx, id)
      if (!canAmend(parent.status)) throw new CrmError('INVALID_TRANSITION', CONTRACT_SIGN.amendOnlyConcluded)
      const cur: ContractVersionRow | null = await cv(tx).findFirst({
        where: { contractId: id, versionNo: parent.currentVersionNo }, select: VERSION_SELECT,
      })
      if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_MSG.versionNotFound)
      const contractNo = await nextContractNo(tx, pattern, kstTodayKey())
      const auto = cur.quoteSnapshot ? autoValuesFrom(cur.quoteSnapshot, contractNo) : { 'contract.no': contractNo }
      const fieldValues = mergeFieldValues(auto, manualOf(cur.fieldValues))
      const created = await c(tx).create({
        data: {
          workspaceId, dealId: parent.dealId, quoteId: parent.quoteId, contractNo,
          title: CONTRACT_SIGN.amendTitle(parent.title).slice(0, MAX_TITLE),
          templateId: parent.templateId, parentContractId: parent.id, currentVersionNo: 1,
          totalMinor: parent.totalMinor === null ? null : BigInt(parent.totalMinor), currency: parent.currency,
          effectiveFrom: dateOrNull(fieldValues['contract.start']?.value),
          effectiveTo: dateOrNull(fieldValues['contract.end']?.value),
          createdById: actorId,
        },
        select: SELECT,
      })
      await cv(tx).create({
        data: {
          workspaceId, contractId: created.id, versionNo: 1, kind: 'AMENDED' satisfies ContractVersionKind,
          body: cur.body, fieldValues,
          quoteSnapshot: cur.quoteSnapshot ?? undefined,
          supplierSnapshot: cur.quoteSnapshot?.supplier ?? undefined,
          customerSnapshot: cur.quoteSnapshot ? { ...cur.quoteSnapshot.customer, ...pickCustomer(fieldValues) } : undefined,
          signatureSnapshot: cur.signatureSnapshot ?? undefined,
          templateVersionNo: cur.templateVersionNo,
          sourceQuoteId: cur.sourceQuoteId, sourceQuoteVersion: cur.sourceQuoteVersion,
          contentHash: contentHash(cur.body, fieldValues),
          note: CONTRACT_SIGN.amendNote(parent.contractNo), createdById: actorId,
        },
      })
      await writeAudit(tx, {
        actorType: 'HUMAN', actorId, action: 'contract.amended', targetType: 'contract', targetId: created.id,
        afterJson: { contractNo, parentContractId: parent.id, parentContractNo: parent.contractNo, fromVersionNo: cur.versionNo },
      })
      return { contract: toRow(created), versionNo: 1 }
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw new CrmError('CONFLICT', CONTRACT_MSG.numberTaken)
    throw e
  }
}
