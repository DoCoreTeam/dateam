/**
 * 계약서 보냄 체결 해지 취소 (P0132 I10)
 *
 * - 보냄은 상태가 아니라 체크다. 그때의 버전 번호를 남긴다 — 고객이 무엇을 받았는지
 * - 체결하면 글이 굳는다(버전 쓰기 거절은 canWriteVersion). 그 버전 번호와 서명본을 남긴다
 * - 체결은 딜 금액을 정한다: 계약 금액(공급가)과 대표 견적을 채우고 금액 이력에 출처를 남긴다
 *   계약서, 딜, 금액 이력, 감사 기록이 **한 트랜잭션**이다 — 하나만 남는 일은 없다
 * - 체결과 해지는 관리자만. 서버가 거절한다, 화면이 단추를 감추는 것과 따로
 *
 * 서명본은 이 딜에 「계약서」 종류로 올린 첨부여야 한다. 첨부는 비공개 버킷에 있고
 * 서명 주소로만 열린다(services/attachment.ts). 다른 딜이나 다른 종류의 파일은 못 고른다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { hasCrmRole, type CrmRole } from '../auth/role.ts'
import {
  CONTRACT_ACTION_ROLE, CONTRACT_ACTION_TO, canSend, canTransition, type ContractAction, type ContractStatus,
} from '../domain/contract-status.ts'
import type { QuoteDocument } from '../domain/quote-document.ts'
import { findContract, type ContractRow } from './contract.ts'
import { recalcLedger } from './ledger.ts'
import { CONTRACT_MSG, CONTRACT_SIGN, CONTRACT_STATUS_LABEL } from '../../terms/contract-doc.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const any = (db: unknown): any => db

/** 동작을 할 수 있는 사람인가 — 서버의 판정 */
export function assertActionRole(role: CrmRole, action: ContractAction): void {
  if (!hasCrmRole(role, CONTRACT_ACTION_ROLE[action])) throw new CrmError('FORBIDDEN', CONTRACT_SIGN.adminOnly)
}

/** 상태가 그 동작을 받나 */
export function assertActionState(status: string, action: ContractAction): void {
  if (action === 'send') {
    if (!canSend(status)) throw new CrmError('INVALID_TRANSITION', CONTRACT_SIGN.sendOnlyDraft)
    return
  }
  const to = CONTRACT_ACTION_TO[action] as ContractStatus
  if (!canTransition(status as ContractStatus, to)) {
    throw new CrmError('INVALID_TRANSITION', CONTRACT_SIGN.badTransition(CONTRACT_STATUS_LABEL[status] ?? status, CONTRACT_STATUS_LABEL[to]))
  }
}

/** 동작마다 계약서에 쓰는 칸 — 보냄과 체결은 그때의 버전 번호를 든다 */
export function contractPatchFor(
  action: ContractAction, contract: Pick<ContractRow, 'currentVersionNo'>, now: Date, signedAttachmentId: string | null,
): Record<string, unknown> {
  switch (action) {
    case 'send': return { sentAt: now, sentVersionNo: contract.currentVersionNo }
    case 'conclude': return {
      status: 'CONCLUDED', concludedAt: now, concludedVersionNo: contract.currentVersionNo,
      ...(signedAttachmentId ? { signedAttachmentId } : {}),
    }
    case 'terminate': return { status: 'TERMINATED', terminatedAt: now }
    case 'cancel': return { status: 'CANCELLED' }
  }
}

/** 계약 금액은 공급가다 — 딜의 다른 금액(예산, 제안가)과 같은 기준 */
export function contractNetOf(snapshot: Pick<QuoteDocument, 'totals'> | null): bigint | null {
  const raw = snapshot?.totals?.netTotalMinor
  return raw === undefined || raw === null || raw === '' ? null : BigInt(raw)
}

export interface ContractActionInput {
  signedAttachmentId?: unknown
}

export interface ContractActor {
  memberId: string | null
  role: CrmRole
}

/** 서명본 — 이 딜에 계약서 종류로 올린, 지우지 않은 첨부 */
async function checkSignedAttachment(tx: unknown, dealId: string, raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') throw new CrmError('VALIDATION_FAILED', CONTRACT_SIGN.signedNotFound, { field: 'signedAttachmentId' })
  const row = await any(tx).crmAttachment.findFirst({
    where: { id: raw, targetType: 'DEAL', targetId: dealId, kind: 'CONTRACT', deletedAt: null },
    select: { id: true },
  })
  if (!row) throw new CrmError('VALIDATION_FAILED', CONTRACT_SIGN.signedNotFound, { field: 'signedAttachmentId' })
  return row.id
}

/** 체결이 딜 금액을 정한다 — 계약 금액, 대표 견적, 금액 이력(출처), 장부 재계산 */
async function bookDealAmount(tx: unknown, workspaceId: string, actorId: string | null, contract: ContractRow): Promise<{ from: string | null; to: string | null }> {
  const version = await any(tx).crmContractVersion.findFirst({
    where: { contractId: contract.id, versionNo: contract.currentVersionNo }, select: { quoteSnapshot: true },
  })
  const net = contractNetOf(version?.quoteSnapshot ?? null)
  if (net === null) return { from: null, to: null }
  const deal = await any(tx).crmDeal.findFirst({
    where: { id: contract.dealId }, select: { contractNetMinor: true, primaryQuoteId: true, currency: true },
  })
  if (!deal) throw new CrmError('NOT_FOUND', CONTRACT_MSG.notFound)
  if (deal.currency && contract.currency && deal.currency !== contract.currency) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_SIGN.currencyMismatch(deal.currency, contract.currency))
  }
  await any(tx).crmDeal.update({
    where: { id: contract.dealId },
    data: { contractNetMinor: net, ...(contract.quoteId ? { primaryQuoteId: contract.quoteId } : {}) },
  })
  await any(tx).crmDealAmountHistory.create({
    data: {
      workspaceId, dealId: contract.dealId, field: 'contract',
      fromMinor: deal.contractNetMinor, toMinor: net,
      reason: CONTRACT_SIGN.amountReason(contract.contractNo),
      sourceQuoteId: contract.quoteId, changedById: actorId,
    },
  })
  await recalcLedger(tx as CrmDb, contract.dealId, actorId)
  const str = (v: bigint | null) => (v === null ? null : String(v))
  return { from: str(deal.contractNetMinor), to: str(net) }
}

/** 보냄 체결 해지 취소 — 한 트랜잭션 */
export async function changeContractStatus(
  workspaceId: string, actor: ContractActor, id: string, version: number, action: ContractAction, input: ContractActionInput = {},
): Promise<ContractRow> {
  assertActionRole(actor.role, action)
  return withCrmTx(workspaceId, async (tx) => {
    const contract = await findContract(tx, id)
    if (contract.version !== version) throw new CrmError('CONFLICT', CONTRACT_MSG.conflict)
    assertActionState(contract.status, action)
    const signed = action === 'conclude' ? await checkSignedAttachment(tx, contract.dealId, input.signedAttachmentId) : null
    const n = await any(tx).crmContract.updateMany({
      where: { id, version },
      data: { ...contractPatchFor(action, contract, new Date(), signed), version: { increment: 1 } },
    })
    if (n.count === 0) throw new CrmError('CONFLICT', CONTRACT_MSG.conflict)
    const amount = action === 'conclude' ? await bookDealAmount(tx, workspaceId, actor.memberId, contract) : null
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId: actor.memberId, action: `contract.${action}`, targetType: 'contract', targetId: id,
      beforeJson: { status: contract.status },
      afterJson: {
        versionNo: contract.currentVersionNo, ...(signed ? { signedAttachmentId: signed } : {}),
        ...(amount ? { dealId: contract.dealId, contractNetMinor: amount } : {}),
      },
    })
    return findContract(tx, id)
  })
}
