/**
 * 딜 원가 — 갈래 10 × 시점 3 (기획 차수 2)
 *
 * **왜 딜에 붙나**: 원가는 견적 항목 하나가 아니라 **이 사업 전체**에 든다.
 * 인건비·장비·외주·클라우드가 항목마다 쪼개지지 않는 경우가 대부분이라
 * 딜에 모아 두고, 필요하면 견적 항목(`quoteLineId`)에 연결한다.
 *
 * **왜 시점이 셋인가**: 견적 낼 때의 추정(ESTIMATE), 계약하며 확정한 것(COMMITTED),
 * 끝나고 실제로 쓴 것(ACTUAL). 셋을 한 칸에 덮어쓰면 **추정이 얼마나 틀렸는지**를
 * 영원히 알 수 없다 — 다음 견적이 같은 실수를 반복한다.
 *
 * **이 파일은 절대 고객에게 안 나간다.** 견적서(`quote-document.ts`)의 입력 타입에
 * 원가 자리가 없어 **담을 수 없다**(security/sensitivity.ts 의 restricted).
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { CrmError } from '../domain/errors.ts'
import { writeAudit } from '../db/audit.ts'
import {
  computeCostAmount, computeCostTotals, computeMargin,
  type CostRow, type CostTotals, type Margin,
} from '../domain/cost.ts'
import { COST_CATEGORY_ORDER, COST_STAGE_ORDER, type CostCategory, type CostStage, type CostInputMode } from '../../terms/cost.ts'
import { toMinor } from '../domain/money.ts'

const SELECT = {
  id: true, dealId: true, quoteLineId: true, category: true, stage: true, inputMode: true,
  name: true, descriptionMd: true, amountMinor: true, currency: true,
  laborGradeId: true, effortMm: true, ratioPct: true, ratioBase: true, basisNote: true,
  createdAt: true, updatedAt: true,
} as const

export interface DealCostRow {
  id: string
  dealId: string
  quoteLineId: string | null
  category: CostCategory
  stage: CostStage
  inputMode: CostInputMode
  name: string
  descriptionMd: string | null
  amountMinor: bigint
  currency: string
  laborGradeId: string | null
  effortMm: unknown
  ratioPct: unknown
  ratioBase: string | null
  basisNote: string | null
}

export interface DealCostInput {
  category: string
  stage?: string
  inputMode?: string
  name: string
  descriptionMd?: string | null
  amountMinor?: string | number | null
  laborGradeId?: string | null
  effortMm?: string | number | null
  ratioPct?: string | number | null
  ratioBase?: string | null
  basisNote?: string | null
  quoteLineId?: string | null
}

function assertEnum<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T, field: string): T {
  if (v === undefined || v === '') return fallback
  if (!(allowed as readonly string[]).includes(v)) {
    throw new CrmError('VALIDATION_FAILED', `모르는 ${field} 입니다: ${v}`, { field })
  }
  return v as T
}

/** 등급 단가는 **서버가 읽는다.** 화면이 보낸 단가를 믿으면 원가를 마음대로 낮출 수 있다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gradeCost(tx: any, gradeId: string | null | undefined): Promise<bigint | null> {
  if (!gradeId) return null
  const g = await tx.crmLaborGrade.findFirst({
    where: { id: gradeId }, select: { costPerMmMinor: true },
  }) as { costPerMmMinor: bigint } | null
  if (!g) throw new CrmError('VALIDATION_FAILED', '등급을 찾을 수 없습니다.', { field: 'laborGradeId' })
  return g.costPerMmMinor
}

export interface DealCostView {
  items: DealCostRow[]
  totals: CostTotals
  margin: Margin
  /** 수주 매출 — 마진 계산의 분모. 화면이 다시 구하지 않게 함께 준다 */
  revenueMinor: string
}

/** 딜 하나의 원가 전부 + 합계 + 마진 */
export async function listDealCosts(db: CrmDb, dealId: string): Promise<DealCostView> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal = await (db as any).crmDeal.findFirst({
    where: { id: dealId },
    select: { bookedNetMinor: true, contractNetMinor: true, quotedNetMinor: true, budgetNetMinor: true, amountMinor: true },
  }) as Record<string, bigint | null> | null
  if (!deal) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmDealCost.findMany({
    where: { dealId },
    select: SELECT,
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
  }) as DealCostRow[]

  const revenue = deal.bookedNetMinor ?? deal.contractNetMinor ?? deal.quotedNetMinor
    ?? deal.budgetNetMinor ?? deal.amountMinor ?? BigInt(0)

  const asRows: CostRow[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    stage: r.stage,
    inputMode: r.inputMode,
    amountMinor: r.amountMinor,
    effortMm: r.effortMm as number | null,
    ratioPct: r.ratioPct as number | null,
    ratioBase: r.ratioBase as 'REVENUE' | 'COST' | null,
  }))

  const totals = computeCostTotals(asRows, revenue)

  /*
    **비율 항목은 저장된 금액이 0이다.**
    「매출의 7%」는 넣는 순간에는 매출이 얼마인지, 다른 원가가 얼마인지 알 수 없다 —
    그래서 저장은 0으로 되고 **조회할 때 계산된다**(computeCostTotals 가 두 번 돌며 채운다).
    그 계산 결과를 항목에도 실어 줘야 한다. 안 그러면 합계는 맞는데
    **화면의 그 줄만 0원**으로 보인다(실브라우저에서 잡았다).
  */
  const withComputed = rows.map((r, i) => (
    r.inputMode === 'RATIO' ? { ...r, amountMinor: totals.amounts[i] } : r
  ))

  return {
    items: withComputed,
    totals,
    margin: computeMargin(revenue, totals.totalMinor),
    revenueMinor: revenue.toString(),
  }
}

export async function createDealCost(
  workspaceId: string, actorId: string | null, dealId: string, input: DealCostInput,
): Promise<DealCostRow> {
  return withCrmTx(workspaceId, async (tx) => {
    const name = (input.name ?? '').trim()
    if (!name) throw new CrmError('VALIDATION_FAILED', '항목 이름을 입력해 주세요.', { field: 'name' })

    const category = assertEnum(input.category, COST_CATEGORY_ORDER, 'EXPENSE', 'category')
    const stage = assertEnum(input.stage, COST_STAGE_ORDER, 'ESTIMATE', 'stage')
    const inputMode = assertEnum(input.inputMode, ['AMOUNT', 'EFFORT', 'RATIO'] as const, 'AMOUNT', 'inputMode')

    const unit = await gradeCost(tx, input.laborGradeId)
    /*
      금액은 **서버가 계산한다.** 화면이 보낸 값을 그대로 저장하면 공수·단가와
      금액이 어긋난 행이 생기고, 합계는 맞는데 내역이 안 맞는 상태가 된다.
    */
    const amountMinor = computeCostAmount({
      category, stage, inputMode,
      amountMinor: input.amountMinor,
      effortMm: input.effortMm,
      gradeCostPerMmMinor: unit,
      ratioPct: input.ratioPct,
      ratioBase: (input.ratioBase as 'REVENUE' | 'COST' | null) ?? null,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any).crmDealCost.create({
      data: {
        workspaceId, dealId, name,
        quoteLineId: input.quoteLineId || null,
        category, stage, inputMode,
        descriptionMd: (input.descriptionMd ?? '').trim() || null,
        amountMinor,
        laborGradeId: input.laborGradeId || null,
        effortMm: input.effortMm === null || input.effortMm === undefined || input.effortMm === '' ? null : String(input.effortMm),
        ratioPct: input.ratioPct === null || input.ratioPct === undefined || input.ratioPct === '' ? null : String(input.ratioPct),
        ratioBase: input.ratioBase || null,
        basisNote: (input.basisNote ?? '').trim() || null,
        createdById: actorId,
      },
      select: SELECT,
    }) as DealCostRow

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'deal_cost.created',
      targetType: 'deal_cost', targetId: row.id,
      afterJson: { name, category, stage, amountMinor: amountMinor.toString() },
    })
    return row
  })
}

export async function updateDealCost(
  workspaceId: string, actorId: string | null, id: string, input: DealCostInput,
): Promise<DealCostRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmDealCost.findFirst({ where: { id }, select: SELECT }) as DealCostRow | null
    if (!before) throw new CrmError('NOT_FOUND', '원가 항목을 찾을 수 없습니다.')

    const category = assertEnum(input.category ?? before.category, COST_CATEGORY_ORDER, 'EXPENSE', 'category')
    const stage = assertEnum(input.stage ?? before.stage, COST_STAGE_ORDER, 'ESTIMATE', 'stage')
    const inputMode = assertEnum(input.inputMode ?? before.inputMode, ['AMOUNT', 'EFFORT', 'RATIO'] as const, 'AMOUNT', 'inputMode')
    const gradeId = input.laborGradeId !== undefined ? input.laborGradeId : before.laborGradeId
    const unit = await gradeCost(tx, gradeId)

    const amountMinor = computeCostAmount({
      category, stage, inputMode,
      amountMinor: input.amountMinor !== undefined ? input.amountMinor : before.amountMinor,
      effortMm: input.effortMm !== undefined ? input.effortMm : (before.effortMm as number | null),
      gradeCostPerMmMinor: unit,
      ratioPct: input.ratioPct !== undefined ? input.ratioPct : (before.ratioPct as number | null),
      ratioBase: (input.ratioBase ?? before.ratioBase) as 'REVENUE' | 'COST' | null,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any).crmDealCost.update({
      where: { id },
      data: {
        name: input.name !== undefined ? (input.name.trim() || before.name) : undefined,
        category, stage, inputMode,
        descriptionMd: input.descriptionMd !== undefined ? (input.descriptionMd?.trim() || null) : undefined,
        amountMinor,
        laborGradeId: gradeId || null,
        effortMm: input.effortMm === '' ? null : input.effortMm !== undefined ? String(input.effortMm) : undefined,
        ratioPct: input.ratioPct === '' ? null : input.ratioPct !== undefined ? String(input.ratioPct) : undefined,
        ratioBase: input.ratioBase !== undefined ? (input.ratioBase || null) : undefined,
        basisNote: input.basisNote !== undefined ? (input.basisNote?.trim() || null) : undefined,
      },
      select: SELECT,
    }) as DealCostRow

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'deal_cost.updated',
      targetType: 'deal_cost', targetId: id,
      beforeJson: { amountMinor: before.amountMinor.toString() },
      afterJson: { amountMinor: amountMinor.toString() },
    })
    return row
  })
}

export async function deleteDealCost(workspaceId: string, actorId: string | null, id: string): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmDealCost.findFirst({ where: { id }, select: { id: true, name: true } })
    if (!before) throw new CrmError('NOT_FOUND', '원가 항목을 찾을 수 없습니다.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmDealCost.delete({ where: { id } })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'deal_cost.deleted',
      targetType: 'deal_cost', targetId: id, beforeJson: before,
    })
  })
}

/** JSON 으로 나갈 모양 — BigInt 는 못 싣는다 */
export function toCostJson(r: DealCostRow): Record<string, unknown> {
  return {
    ...r,
    amountMinor: r.amountMinor.toString(),
    effortMm: r.effortMm === null ? null : String(r.effortMm),
    ratioPct: r.ratioPct === null ? null : String(r.ratioPct),
  }
}

export function toTotalsJson(v: DealCostView): Record<string, unknown> {
  return {
    items: v.items.map(toCostJson),
    revenueMinor: v.revenueMinor,
    totals: {
      totalMinor: v.totals.totalMinor.toString(),
      byCategory: Object.fromEntries(
        Object.entries(v.totals.byCategory).map(([k, x]) => [k, (x as bigint).toString()]),
      ),
      byStage: Object.fromEntries(
        Object.entries(v.totals.byStage).map(([k, x]) => [k, (x as bigint).toString()]),
      ),
    },
    margin: {
      grossProfitMinor: v.margin.grossProfitMinor.toString(),
      marginPct: v.margin.marginPct,
    },
  }
}

export { toMinor }
