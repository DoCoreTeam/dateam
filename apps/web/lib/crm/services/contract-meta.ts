/**
 * 계약 정보 고치기 — 만들 때 고른 방향 양식 종류 제목 당사자 (P0184 I10)
 *
 * 만들 때 고르게 한 칸은 만든 뒤에도 고칠 수 있어야 한다 (crm-update-standard 가드).
 *
 * - 방향을 바꾸면 민감 등급도 따라 바뀐다. 볼 수 없는 등급으로는 못 바꾼다 — 바꾸고 못 보는 계약이 생긴다
 * - 당사자를 바꾸면 당사자에서 채운 칸(공급자 고객 갑 을)이 바뀌므로 **다음 버전**을 남긴다. 손으로 넣은 칸은 그대로
 * - 견적에서 만든 계약의 당사자는 견적을 따른다 — 여기서 바꾸면 다시 채우기가 되돌린다
 * - 체결 전에만. 체결한 글은 그날 날인한 글이다
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx, type TxCapableClient, type TxLike } from '../db/tx.ts'
import { writeAudit, type AuditCapableTx } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { contentHash, type Clause } from '../domain/contract-body.ts'
import { mergeFieldValues, type FieldValues } from '../domain/contract-fields.ts'
import { sensitivityOfDirection, visibleSensitivities } from '../domain/contract-sensitivity.ts'
import type { CrmRole } from '../auth/role.ts'
import { CONTRACT_SELECT, cleanTitle, findContract, manualOf, toRow, type ContractRow } from './contract.ts'
import { CONTRACT_DIRECTIONS, CONTRACT_DOC_LAYERS, CONTRACT_FORM_OWNERS } from './contract-create.ts'
import { assertPartyCompanies, autoValuesFromParties, checkParties, replaceParties } from './contract-party.ts'
import { CONTRACT_MSG, CONTRACT_META } from '../../terms/contract-doc.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const any = (db: unknown): any => db
type Tx = TxLike & AuditCapableTx

export interface ContractMetaInput {
  title?: unknown
  direction?: unknown
  formOwner?: unknown
  docLayer?: unknown
  parties?: unknown
}

function pick<T extends string>(v: unknown, allowed: readonly T[], message: string, field: string): T | undefined {
  if (v === undefined) return undefined
  if (!allowed.includes(v as T)) throw new CrmError('VALIDATION_FAILED', message, { field })
  return v as T
}

export async function updateContractMeta(
  db: CrmDb, workspaceId: string, actor: { memberId: string | null; role: CrmRole }, id: string, version: number, input: ContractMetaInput,
): Promise<ContractRow> {
  const direction = pick(input.direction, CONTRACT_DIRECTIONS, CONTRACT_MSG.badDirection, 'direction')
  const formOwner = pick(input.formOwner, CONTRACT_FORM_OWNERS, CONTRACT_MSG.badFormOwner, 'formOwner')
  const docLayer = pick(input.docLayer, CONTRACT_DOC_LAYERS, CONTRACT_MSG.badDocLayer, 'docLayer')
  return withCrmTx(workspaceId, async (tx) => {
    const contract = await findContract(tx, id)
    if (contract.version !== version) throw new CrmError('CONFLICT', CONTRACT_MSG.conflict)
    if (contract.status !== 'DRAFT') throw new CrmError('INVALID_TRANSITION', CONTRACT_META.notDraft)
    const nextDirection = direction ?? contract.direction
    const sensitivity = sensitivityOfDirection(nextDirection)
    if (!visibleSensitivities(actor.role).includes(sensitivity)) throw new CrmError('FORBIDDEN', CONTRACT_MSG.sensitivityDenied)

    let currentVersionNo = contract.currentVersionNo
    if (input.parties !== undefined) {
      if (contract.quoteId) throw new CrmError('VALIDATION_FAILED', CONTRACT_META.partiesFollowQuote, { field: 'parties' })
      const parties = checkParties(input.parties, nextDirection)
      await assertPartyCompanies(tx, parties)
      await replaceParties(tx, workspaceId, id, parties)
      currentVersionNo = await writePartyVersion(tx, workspaceId, actor.memberId, contract, autoValuesFromParties(parties, contract.contractNo))
    }

    const data = {
      ...(input.title !== undefined ? { title: cleanTitle(input.title, contract.title) } : {}),
      ...(direction ? { direction, sensitivity } : {}),
      ...(formOwner ? { formOwner } : {}),
      ...(docLayer ? { docLayer } : {}),
      currentVersionNo,
    }
    const n = await any(tx).crmContract.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } })
    if (n.count === 0) throw new CrmError('CONFLICT', CONTRACT_MSG.conflict)
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId: actor.memberId, action: 'contract.meta_updated', targetType: 'contract', targetId: id,
      beforeJson: { title: contract.title, direction: contract.direction, formOwner: contract.formOwner, docLayer: contract.docLayer },
      afterJson: { ...data, parties: input.parties === undefined ? undefined : 'replaced' },
    })
    return toRow(await any(tx).crmContract.findFirst({ where: { id }, select: CONTRACT_SELECT }))
  }, db as unknown as TxCapableClient<Tx>)
}

/** 당사자에서 채운 칸을 새 값으로, 손으로 넣은 칸은 그대로 두고 다음 버전을 남긴다 */
async function writePartyVersion(
  tx: unknown, workspaceId: string, actorId: string | null, contract: ContractRow, auto: Record<string, string>,
): Promise<number> {
  const cur = await any(tx).crmContractVersion.findFirst({
    where: { contractId: contract.id, versionNo: contract.currentVersionNo },
    select: { versionNo: true, body: true, fieldValues: true, signatureSnapshot: true, templateVersionNo: true },
  })
  if (!cur) throw new CrmError('NOT_FOUND', CONTRACT_MSG.versionNotFound)
  const fieldValues = mergeFieldValues(auto, manualOf(cur.fieldValues as FieldValues))
  const body = cur.body as Clause[]
  const versionNo = cur.versionNo + 1
  await any(tx).crmContractVersion.create({
    data: {
      workspaceId, contractId: contract.id, versionNo, kind: 'EDITED', body, fieldValues,
      signatureSnapshot: cur.signatureSnapshot ?? undefined, templateVersionNo: cur.templateVersionNo,
      contentHash: contentHash(body, fieldValues), note: CONTRACT_META.title, createdById: actorId,
    },
  })
  return versionNo
}
