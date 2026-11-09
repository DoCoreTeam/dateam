/**
 * 견적 없이 계약서를 만든다 (P0184 I03)
 *
 * 견적으로 만들기(contract.ts createContractFromQuote)와 같은 번호 규칙, 같은 템플릿 발행본,
 * 같은 버전 1 을 쓴다. 다른 것은 칸 값의 출처가 견적이 아니라 당사자라는 것뿐이다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx, type TxCapableClient, type TxLike } from '../db/tx.ts'
import { writeAudit, type AuditCapableTx } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { contentHash } from '../domain/contract-body.ts'
import { mergeFieldValues } from '../domain/contract-fields.ts'
import type { ContractVersionKind } from '../domain/contract-status.ts'
import { sensitivityOfDirection } from '../domain/contract-sensitivity.ts'
import { checkClauses, defaultTemplateFor, readPublishedTemplate } from './contract-template.ts'
import {
  CONTRACT_SELECT, checkManualFields, cleanTitle, dateOrNull, nextContractNo, readContractNoPattern, readContractSignature,
  retryOnNumberTaken, toRow, type ContractRow,
} from './contract.ts'
import { assertPartyCompanies, autoValuesFromParties, checkParties, writeParties } from './contract-party.ts'
import { kstTodayKey } from '../../datetime/kst.ts'
import { CONTRACT_MSG } from '../../terms/contract-doc.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const c = (db: unknown): any => (db as any).crmContract
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cv = (db: unknown): any => (db as any).crmContractVersion
type Tx = TxLike & AuditCapableTx

export const CONTRACT_DIRECTIONS = ['SALES', 'PURCHASE', 'PARTNERSHIP', 'CONSORTIUM', 'BROKERAGE', 'CORPORATE'] as const
export const CONTRACT_FORM_OWNERS = ['OURS', 'THEIRS', 'ISSUER'] as const
export const CONTRACT_DOC_LAYERS = ['STANDALONE', 'MASTER', 'ORDER', 'AMENDMENT', 'MOU', 'NDA'] as const

export interface CreateContractBlankInput {
  direction?: unknown
  title?: unknown
  templateId?: unknown
  dealId?: unknown
  formOwner?: unknown
  docLayer?: unknown
  parties?: unknown
  manual?: unknown
}

function pickEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T | null, message: string, field: string): T {
  if ((raw === undefined || raw === null || raw === '') && fallback !== null) return fallback
  if (!allowed.includes(raw as T)) throw new CrmError('VALIDATION_FAILED', message, { field })
  return raw as T
}

/**
 * 견적 없이 계약서를 만든다 (P0184 I03) — 매입, 제휴, 공동수급, 3자, 회사 단위.
 *
 * 딜은 있어도 되고 없어도 된다. 등급은 방향에서 나오고, 회사 단위(관리자 등급)를 관리자가 아닌
 * 사람이 만들려 하면 DB 확장의 거름망이 거절한다 (contract-sensitivity).
 */
export async function createContract(
  db: CrmDb, workspaceId: string, actorId: string | null, input: CreateContractBlankInput,
): Promise<{ contract: ContractRow; versionNo: number }> {
  const direction = pickEnum(input.direction, CONTRACT_DIRECTIONS, null, CONTRACT_MSG.badDirection, 'direction')
  const formOwner = pickEnum(input.formOwner, CONTRACT_FORM_OWNERS, 'OURS', CONTRACT_MSG.badFormOwner, 'formOwner')
  const docLayer = pickEnum(input.docLayer, CONTRACT_DOC_LAYERS, 'STANDALONE', CONTRACT_MSG.badDocLayer, 'docLayer')
  const title = cleanTitle(input.title, '')
  const parties = checkParties(input.parties, direction)
  const manual = checkManualFields(input.manual)
  await assertPartyCompanies(db, parties)

  const dealId = typeof input.dealId === 'string' && input.dealId ? input.dealId : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal = dealId ? await (db as any).crmDeal.findFirst({ where: { id: dealId }, select: { businessTypeKey: true } }) : null
  if (dealId && !deal) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.dealNotFound, { field: 'dealId' })

  const templateId = typeof input.templateId === 'string' && input.templateId
    ? input.templateId
    : (await defaultTemplateFor(db, deal?.businessTypeKey ?? null))?.id
  if (!templateId) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.noTemplate, { field: 'templateId' })
  const [{ versionNo: templateVersionNo, body: templateBody }, signature, pattern] = await Promise.all([
    readPublishedTemplate(db, templateId), readContractSignature(db), readContractNoPattern(db),
  ])
  const body = checkClauses(templateBody)
  if (body.length === 0) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.noClauses)

  // 받은 연결로 트랜잭션을 연다 — 창구가 넘긴 것은 이 워크스페이스로 못 박힌 getCrmDb 다
  return retryOnNumberTaken(() => withCrmTx(workspaceId, async (tx: Tx) => {
    const contractNo = await nextContractNo(tx, pattern, kstTodayKey())
    const fieldValues = mergeFieldValues(autoValuesFromParties(parties, contractNo), manual)
    const created = await c(tx).create({
      data: {
        workspaceId, dealId, contractNo, title, templateId, direction, formOwner, docLayer,
        sensitivity: sensitivityOfDirection(direction), currentVersionNo: 1,
        effectiveFrom: dateOrNull(fieldValues['contract.start']?.value),
        effectiveTo: dateOrNull(fieldValues['contract.end']?.value),
        createdById: actorId,
      },
      select: CONTRACT_SELECT,
    })
    await cv(tx).create({
      data: {
        workspaceId, contractId: created.id, versionNo: 1, kind: 'GENERATED' satisfies ContractVersionKind,
        body, fieldValues, signatureSnapshot: signature, templateVersionNo,
        contentHash: contentHash(body, fieldValues), createdById: actorId,
      },
    })
    await writeParties(tx, workspaceId, created.id, parties)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'contract.created', targetType: 'contract', targetId: created.id,
      afterJson: { contractNo, direction, dealId, templateId, templateVersionNo, parties: parties.length },
    })
    return { contract: toRow(created), versionNo: 1 }
  }, db as unknown as TxCapableClient<Tx>))
}
