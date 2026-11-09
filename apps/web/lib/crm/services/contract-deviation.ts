/**
 * 표준 이탈 — 읽고, 승인하고, 체결을 막는 자리 (P0184 I08)
 *
 * 판정은 domain/contract-deviation.ts 가 하고 여기는 재료(현재 버전, 템플릿 발행본, 라이브러리 승인본,
 * 승인 기록)를 모아 넘긴다. 체결(contract-sign)은 트랜잭션 안에서 assertDeviationsApproved 를 부른다.
 *
 * **승인은 관리자만, 판정은 서버에서.** 창구가 무엇이든 역할을 여기서 다시 본다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx, type TxCapableClient, type TxLike } from '../db/tx.ts'
import { writeAudit, type AuditCapableTx } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { hasCrmRole, type CrmRole } from '../auth/role.ts'
import type { Clause } from '../domain/contract-body.ts'
import { clauseIdOf, type ClauseText } from '../domain/contract-assemble.ts'
import { canConcludeWith, detectDeviations, type Deviation } from '../domain/contract-deviation.ts'
import { findContract, type ContractRow } from './contract.ts'
import { CONTRACT_DEVIATION_MSG, CONTRACT_MSG } from '../../terms/contract-doc.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const any = (db: unknown): any => db
type Tx = TxLike & AuditCapableTx

export interface DeviationState {
  versionNo: number
  contentHash: string
  deviations: Deviation[]
  approval: { versionNo: number; contentHash: string; approvedById: string | null; approvedAt: Date } | null
  canConclude: boolean
}

/** 라이브러리 승인본 — 키마다 가장 최근 번호, 한국어가 먼저 */
async function libraryBaseline(tx: unknown): Promise<Map<string, ClauseText>> {
  const rows: { key: string; lang: string; title: string; html: string }[] = await any(tx).crmContractClause.findMany({
    where: { status: 'APPROVED' },
    orderBy: [{ key: 'asc' }, { versionNo: 'desc' }],
    select: { key: true, lang: true, title: true, html: true },
  })
  const out = new Map<string, ClauseText>()
  for (const lang of ['ko', 'en']) {
    for (const r of rows) {
      const id = clauseIdOf(r.key)
      if (r.lang === lang && !out.has(id)) out.set(id, { title: r.title, html: r.html })
    }
  }
  return out
}

async function templateBaseline(tx: unknown, templateId: string | null, versionNo: number | null): Promise<Clause[] | null> {
  if (!templateId || !versionNo) return null
  const v = await any(tx).crmContractTemplateVersion.findFirst({ where: { templateId, versionNo }, select: { body: true } })
  return v ? (v.body as Clause[]) : null
}

export async function readDeviationState(tx: unknown, contract: Pick<ContractRow, 'id' | 'templateId' | 'currentVersionNo'>): Promise<DeviationState> {
  const version = await any(tx).crmContractVersion.findFirst({
    where: { contractId: contract.id, versionNo: contract.currentVersionNo },
    select: { versionNo: true, body: true, contentHash: true, templateVersionNo: true },
  })
  if (!version) throw new CrmError('NOT_FOUND', CONTRACT_MSG.notFound)
  const [library, template, approval] = await Promise.all([
    libraryBaseline(tx),
    templateBaseline(tx, contract.templateId, version.templateVersionNo),
    any(tx).crmContractDeviationApproval.findFirst({
      where: { contractId: contract.id, versionNo: version.versionNo },
      select: { versionNo: true, contentHash: true, approvedById: true, approvedAt: true },
    }),
  ])
  const deviations = detectDeviations(version.body as Clause[], { library, template })
  return {
    versionNo: version.versionNo, contentHash: version.contentHash, deviations, approval: approval ?? null,
    canConclude: canConcludeWith(deviations, version, approval ?? null),
  }
}

export async function getDeviationState(db: CrmDb, contractId: string): Promise<DeviationState> {
  return readDeviationState(db, await findContract(db, contractId))
}

/** 체결 관문 — 이탈이 있는데 이 버전 이 지문의 승인이 없으면 거절한다 */
export async function assertDeviationsApproved(tx: unknown, contract: Pick<ContractRow, 'id' | 'templateId' | 'currentVersionNo'>): Promise<void> {
  const state = await readDeviationState(tx, contract)
  if (!state.canConclude) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_DEVIATION_MSG.needsApproval(state.deviations.length), { deviations: state.deviations })
  }
}

export interface DeviationActor { memberId: string | null; role: CrmRole }

/** 관리자가 지금 버전의 이탈을 승인한다. 승인 기록은 버전과 지문을 들고 감사 로그에 남는다 */
export async function approveContractDeviations(
  db: CrmDb, workspaceId: string, actor: DeviationActor, contractId: string, version: number, note?: unknown,
): Promise<DeviationState> {
  if (!hasCrmRole(actor.role, 'ADMIN')) throw new CrmError('FORBIDDEN', CONTRACT_DEVIATION_MSG.approveDenied)
  const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : null
  return withCrmTx(workspaceId, async (tx) => {
    const contract = await findContract(tx, contractId)
    if (contract.version !== version) throw new CrmError('CONFLICT', CONTRACT_MSG.conflict)
    if (contract.status !== 'DRAFT') throw new CrmError('INVALID_TRANSITION', CONTRACT_DEVIATION_MSG.notDraft)
    const state = await readDeviationState(tx, contract)
    if (state.deviations.length === 0) throw new CrmError('VALIDATION_FAILED', CONTRACT_DEVIATION_MSG.noDeviations)
    if (state.approval) throw new CrmError('CONFLICT', CONTRACT_DEVIATION_MSG.alreadyApproved)
    await any(tx).crmContractDeviationApproval.create({
      data: {
        contractId, versionNo: state.versionNo, contentHash: state.contentHash,
        deviations: state.deviations.map(({ clauseId, reason }) => ({ clauseId, reason })),
        note: cleanNote, approvedById: actor.memberId,
      },
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId: actor.memberId, action: 'contract.deviation_approved', targetType: 'contract', targetId: contractId,
      afterJson: { versionNo: state.versionNo, contentHash: state.contentHash, deviations: state.deviations.length, note: cleanNote },
    })
    return readDeviationState(tx, contract)
  }, db as unknown as TxCapableClient<Tx>)
}
