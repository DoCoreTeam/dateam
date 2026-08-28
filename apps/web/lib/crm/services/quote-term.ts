/**
 * 거래 조건 항목 — 사업 스타일마다 조건이 다르다
 *
 * **왜 한 덩어리 텍스트가 아닌가**: 설정에 통째로 적어 두면 모든 견적서에 똑같이 나간다.
 * 그런데 GPU 사업 조건(이용 기간 변경 시 금액 변동)과 SI 사업 조건(검수 후 30일)은 다르다.
 * 관리자가 **하나씩 등록**하고 영업이 견적마다 **고른다**
 * (사용자 지적: 「우리 사업 스타일별로 이 내용이 다 다르거든」).
 *
 * 기획 §08 「단위를 데이터로 — 새 것은 행 하나 추가, 코드 수정 없다」와 같은 방식이다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText, requireText } from '../domain/normalize.ts'

export interface QuoteTermRow {
  id: string
  title: string
  body: string
  businessType: string | null
  isDefault: boolean
  position: number
  isActive: boolean
}

const SELECT = {
  id: true, title: true, body: true, businessType: true,
  isDefault: true, position: true, isActive: true,
} as const

export async function listQuoteTerms(db: CrmDb): Promise<QuoteTermRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmQuoteTerm.findMany({
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: SELECT,
  }) as Promise<QuoteTermRow[]>
}

/**
 * 이 딜에 쓸 만한 조건.
 *
 * 사업 유형이 맞는 것과 «모든 유형»(businessType = null)을 함께 준다 —
 * 유형을 안 정한 딜에서 조건이 하나도 안 보이면 고를 수가 없다.
 */
export async function listQuoteTermsFor(db: CrmDb, businessType: string | null): Promise<QuoteTermRow[]> {
  const all = await listQuoteTerms(db)
  return all.filter((t) =>
    t.isActive && (t.businessType === null || t.businessType === businessType))
}

export interface QuoteTermInput {
  title?: string | null
  body?: string | null
  businessType?: string | null
  isDefault?: boolean
  position?: number
  isActive?: boolean
}

export async function createQuoteTerm(
  workspaceId: string, actorId: string | null, input: QuoteTermInput,
): Promise<QuoteTermRow> {
  const title = requireText(input.title)
  const body = requireText(input.body)
  if (!title) throw new CrmError('VALIDATION_FAILED', '조건 이름을 입력해 주세요.', { field: 'title' })
  if (!body) throw new CrmError('VALIDATION_FAILED', '견적서에 인쇄될 문장을 입력해 주세요.', { field: 'body' })

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = await (tx as any).crmQuoteTerm.findFirst({
      orderBy: { position: 'desc' }, select: { position: true },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any).crmQuoteTerm.create({
      data: {
        title, body,
        businessType: input.businessType || null,
        isDefault: input.isDefault ?? false,
        position: (last?.position ?? -1) + 1,
        createdById: actorId,
      },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'quote_term.created',
      targetType: 'quote_term', targetId: row.id, afterJson: { title },
    })
    return row as QuoteTermRow
  })
}

export async function updateQuoteTerm(
  workspaceId: string, actorId: string | null, id: string, input: QuoteTermInput,
): Promise<QuoteTermRow> {
  return withCrmTx(workspaceId, async (tx) => {
    const data: Record<string, unknown> = {}
    if (input.title !== undefined) {
      const t = requireText(input.title)
      if (!t) throw new CrmError('VALIDATION_FAILED', '조건 이름을 입력해 주세요.', { field: 'title' })
      data.title = t
    }
    if (input.body !== undefined) {
      const b = requireText(input.body)
      if (!b) throw new CrmError('VALIDATION_FAILED', '견적서에 인쇄될 문장을 입력해 주세요.', { field: 'body' })
      data.body = b
    }
    if (input.businessType !== undefined) data.businessType = normalizeText(input.businessType)
    if (input.isDefault !== undefined) data.isDefault = Boolean(input.isDefault)
    if (input.isActive !== undefined) data.isActive = Boolean(input.isActive)
    if (input.position !== undefined) data.position = Number(input.position)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await (tx as any).crmQuoteTerm.updateMany({ where: { id }, data })
    if (n.count === 0) throw new CrmError('NOT_FOUND', '조건을 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any).crmQuoteTerm.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'quote_term.updated',
      targetType: 'quote_term', targetId: id, afterJson: data,
    })
    return row as QuoteTermRow
  })
}

export async function deleteQuoteTerm(
  workspaceId: string, actorId: string | null, id: string,
): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    // 소프트 삭제 — 이미 보낸 견적이 이 조건을 가리키고 있다.
    // 물리 삭제하면 그 견적서를 다시 열 때 조건이 사라진다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await (tx as any).crmQuoteTerm.updateMany({
      where: { id }, data: { deletedAt: new Date(), isActive: false },
    })
    if (n.count === 0) throw new CrmError('NOT_FOUND', '조건을 찾을 수 없습니다.')
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'quote_term.deleted',
      targetType: 'quote_term', targetId: id,
    })
  })
}
