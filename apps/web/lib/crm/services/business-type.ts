/**
 * 사업 유형 목록 서비스 — 영업 CRM 설정에서 관리한다
 *
 * 거래 조건(`quote-term.ts`)과 같은 모양이다. 다른 점은 셋:
 *  ① **기본 8종은 지울 수 없다** — 예전 딜이 그 값을 가리키고 있다. 숨김만 된다.
 *  ② **쓰고 있는 유형은 지울 수 없다** — 지우면 그 딜의 유형이 「없음」이 된다. 숨김으로 안내한다.
 *  ③ 목록에 **딜 수**를 함께 준다 — 「지워도 되나」에 답하는 유일한 숫자다(R-5).
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import {
  BUSINESS_TYPE_LABEL_ERROR_TEXT,
  normalizeBusinessTypeLabel,
  sortBusinessTypes,
  validateBusinessTypeLabel,
  type BusinessTypeRow,
} from '../domain/business-type.ts'

const SELECT = {
  id: true, key: true, label: true, position: true, isBuiltin: true, isActive: true,
} as const

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 목록 + 유형별 딜 수. 두 번 물어보지 않는다 — 화면이 둘을 함께 쓴다 */
export async function listBusinessTypes(db: CrmDb): Promise<BusinessTypeRow[]> {
  const [rows, counts] = await Promise.all([
    (db as any).crmBusinessTypeOption.findMany({
      orderBy: [{ position: 'asc' }, { label: 'asc' }], select: SELECT,
    }) as Promise<BusinessTypeRow[]>,
    (db as any).crmDeal.groupBy({
      by: ['businessTypeKey'], _count: { _all: true },
    }) as Promise<{ businessTypeKey: string | null; _count: { _all: number } }[]>,
  ])
  const used = new Map(counts.map((c) => [c.businessTypeKey ?? '', c._count._all]))
  return sortBusinessTypes(rows.map((r) => ({ ...r, dealCount: used.get(r.key) ?? 0 })))
}

function reject(kind: keyof typeof BUSINESS_TYPE_LABEL_ERROR_TEXT): never {
  throw new CrmError('VALIDATION_FAILED', BUSINESS_TYPE_LABEL_ERROR_TEXT[kind], { field: 'label' })
}

/** 살아 있는 이름들 — 중복 판정에 쓴다. 자기 자신은 뺀다 */
async function labelsExcept(tx: any, exceptId: string | null): Promise<string[]> {
  const rows = await tx.crmBusinessTypeOption.findMany({ select: { id: true, label: true } })
  return rows.filter((r: { id: string }) => r.id !== exceptId).map((r: { label: string }) => r.label)
}

export async function createBusinessType(
  workspaceId: string, actorId: string | null, input: { label?: string | null },
): Promise<BusinessTypeRow> {
  return withCrmTx(workspaceId, async (tx: any) => {
    const label = normalizeBusinessTypeLabel(input.label)
    const bad = validateBusinessTypeLabel(label, await labelsExcept(tx, null))
    if (bad) reject(bad)

    const last = await tx.crmBusinessTypeOption.findFirst({
      orderBy: { position: 'desc' }, select: { position: true },
    })
    // 키는 **행 id 를 그대로 쓴다** — 이름을 바꿔도 이미 저장된 딜의 값이 안 흔들린다.
    // (기본 8종만 예전 enum 문자열을 키로 갖는다 — 백필이 그 값으로 들어왔다)
    const id = `bt_${workspaceId}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const row = await tx.crmBusinessTypeOption.create({
      data: {
        id, workspaceId, key: id, label,
        position: (last?.position ?? -1) + 1,
        isBuiltin: false, isActive: true, createdById: actorId,
      },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'business_type.created',
      targetType: 'business_type', targetId: row.id, afterJson: { label },
    })
    return { ...(row as BusinessTypeRow), dealCount: 0 }
  })
}

export interface BusinessTypePatch {
  label?: string | null
  isActive?: boolean
  position?: number
}

export async function updateBusinessType(
  workspaceId: string, actorId: string | null, id: string, input: BusinessTypePatch,
): Promise<BusinessTypeRow> {
  return withCrmTx(workspaceId, async (tx: any) => {
    const before = await tx.crmBusinessTypeOption.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '사업 유형을 찾을 수 없습니다.')

    const data: Record<string, unknown> = {}
    if (input.label !== undefined) {
      const label = normalizeBusinessTypeLabel(input.label)
      const bad = validateBusinessTypeLabel(label, await labelsExcept(tx, id))
      if (bad) reject(bad)
      data.label = label
    }
    if (input.isActive !== undefined) data.isActive = Boolean(input.isActive)
    if (input.position !== undefined) data.position = Number(input.position)
    if (Object.keys(data).length === 0) return before as BusinessTypeRow

    await tx.crmBusinessTypeOption.updateMany({ where: { id }, data })
    const row = await tx.crmBusinessTypeOption.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'business_type.updated',
      targetType: 'business_type', targetId: id, beforeJson: before, afterJson: data,
    })
    return row as BusinessTypeRow
  })
}

/** 순서 바꾸기 — 한 번에 다 넣는다. 하나씩 PATCH 하면 중간 상태에서 순서가 뒤집힌다 */
export async function reorderBusinessTypes(
  workspaceId: string, actorId: string | null, ids: readonly string[],
): Promise<BusinessTypeRow[]> {
  return withCrmTx(workspaceId, async (tx: any) => {
    for (let i = 0; i < ids.length; i += 1) {
      await tx.crmBusinessTypeOption.updateMany({ where: { id: ids[i] }, data: { position: i } })
    }
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'business_type.reordered',
      // 대상이 «목록 전체»라 개별 행 id 가 없다 — 워크스페이스를 가리킨다
      targetType: 'business_type_order', targetId: workspaceId, afterJson: { ids: [...ids] },
    })
    return tx.crmBusinessTypeOption.findMany({
      orderBy: [{ position: 'asc' }], select: SELECT,
    }) as Promise<BusinessTypeRow[]>
  })
}

/**
 * 지우기 — **쓰이지 않는 사용자 추가 유형만.**
 *
 * 기본 8종이거나 쓰는 딜이 있으면 거절하고 «숨김»을 안내한다.
 * 조용히 지우면 그 딜들의 유형이 「없음」이 되는데, 사용자는 그 사실을 나중에야 안다.
 */
export async function deleteBusinessType(
  workspaceId: string, actorId: string | null, id: string,
): Promise<void> {
  await withCrmTx(workspaceId, async (tx: any) => {
    const row = await tx.crmBusinessTypeOption.findFirst({ where: { id }, select: SELECT })
    if (!row) throw new CrmError('NOT_FOUND', '사업 유형을 찾을 수 없습니다.')
    if (row.isBuiltin) {
      throw new CrmError('VALIDATION_FAILED',
        '기본 사업 유형은 삭제할 수 없어요. 안 쓰신다면 「숨김」으로 바꿔 주세요.')
    }
    const used = await tx.crmDeal.count({ where: { businessTypeKey: row.key } })
    if (used > 0) {
      throw new CrmError('VALIDATION_FAILED',
        `이 유형을 쓰는 딜이 ${used}건 있어 삭제할 수 없어요. 「숨김」으로 바꾸면 새 딜에서만 사라집니다.`)
    }
    await tx.crmBusinessTypeOption.updateMany({
      where: { id }, data: { deletedAt: new Date(), isActive: false },
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'business_type.deleted',
      targetType: 'business_type', targetId: id, beforeJson: row,
    })
  })
}
