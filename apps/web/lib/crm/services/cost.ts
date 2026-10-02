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
import {
  COST_CATEGORY_ORDER, COST_STAGE_ORDER, LINE_KIND_ORDER,
  LINE_KIND_QUANTITY_LABEL, LINE_KIND_PRICE_LABEL,
  type CostCategory, type CostStage, type CostInputMode, type QuoteLineKind,
} from '../../terms/cost.ts'
import { toMinor } from '../domain/money.ts'
import { isCurrencyCode } from '../domain/currency.ts'
import { eulReul, eunNeun, withJosa } from '../../ui/josa.ts'
import { latestFxRate, needsFx } from './fx.ts'

const SELECT = {
  id: true, dealId: true, quoteLineId: true, category: true, stage: true, inputMode: true,
  name: true, descriptionMd: true, amountMinor: true, currency: true,
  fxRate: true, fxDate: true, fxSource: true,
  kind: true, quantity: true, unit: true, unitPriceMinor: true, remark: true,
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
  /** 만든 날의 환율. KRW 면 null 이고, **못 받았을 때도 null** 이다(1 로 눕히지 않는다) */
  fxRate: unknown
  fxDate: Date | null
  fxSource: string | null
  kind: QuoteLineKind
  quantity: unknown
  unit: string | null
  unitPriceMinor: bigint | null
  remark: string | null
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
  /** 세 글자 코드만 받는다. 안 넘기면 KRW — 표의 기본값과 같다 */
  currency?: string | null
  kind?: string | null
  quantity?: string | number | null
  unit?: string | null
  unitPriceMinor?: string | number | null
  remark?: string | null
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

/**
 * 통화는 **세 글자 코드만** 받는다.
 *
 * 안 넘기면 KRW 다(표의 기본값과 같다). 넘겼는데 코드가 아니면 **그 자리에서 거절한다** —
 * 조용히 KRW 로 눕히면 $1,080.00 의 센트값 108000 이 「108,000원」으로 앉는다
 * (실측 2026-10-02, 참값의 13.46분의 1). 열세 배 작아졌는데 그럴듯한 금액으로 보이는 것이
 * 이 사고의 성질이고, 그래서 **틀린 값은 고쳐 주지 않고 되돌려 보낸다.**
 */
function assertCurrency(v: string | null | undefined, fallback = 'KRW'): string {
  if (v === undefined || v === null || v.trim() === '') return fallback
  const code = v.trim().toUpperCase()
  if (!isCurrencyCode(code)) {
    throw new CrmError('VALIDATION_FAILED', `모르는 통화입니다: ${v}`, { field: 'currency' })
  }
  return code
}

/**
 * 만든 날의 환율을 **박아 둔다.**
 *
 * 조회할 때마다 환산하면 어제 본 마진이 오늘 달라진다 — 아무도 손대지 않은 원가가
 * 아침에 바뀌어 있는 상태다. KRW 면 환산할 것이 없어 셋 다 null 이고,
 * **환율을 못 받았을 때도 null 이다** — 0 이나 1 로 눕히면 1,454,112원이 1,080원으로 앉는다.
 */
async function stampFx(currency: string): Promise<{ fxRate: number | null; fxDate: Date | null; fxSource: string | null }> {
  if (!needsFx(currency)) return { fxRate: null, fxDate: null, fxSource: null }
  const fx = await latestFxRate(currency)
  return {
    fxRate: fx?.rate ?? null,
    fxDate: fx ? new Date(fx.date) : null,
    fxSource: fx?.source ?? null,
  }
}

/**
 * 숫자 칸의 문지기 — **빈 칸과 0 을 가른다.**
 *
 * 못 읽은 것을 0 으로 적으면 0원짜리 줄이 조용히 들어가고, 그 줄은 합계를 안 움직여
 * 아무도 못 알아본다. 음수도 안 받는다 — 할인은 금액을 음수로 만드는 일이 아니다.
 *
 * 오류 문구에 칼럼 이름을 적지 않는다(사람은 `unitPriceMinor` 가 무엇인지 모른다).
 * 고칠 칸은 `field` 로 함께 보내고, 사람에게는 그 칸의 이름으로 말한다.
 */
function assertNumber(v: string | number, field: string, label: string): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) {
    throw new CrmError('VALIDATION_FAILED', `${withJosa(label, eulReul)} 숫자로 입력해 주세요.`, { field })
  }
  if (n < 0) {
    throw new CrmError('VALIDATION_FAILED', `${withJosa(label, eunNeun)} 0보다 작을 수 없어요.`, { field })
  }
  return n
}

/** 단가는 minor 정수다 */
function minorOrNull(v: string | number | null | undefined, field: string, label: string): bigint | null {
  if (v === null || v === undefined || v === '') return null
  assertNumber(v, field, label)
  // 금액을 정수로 만드는 일은 `money.ts` 한 곳에서 한다 — 두 곳에 두면 한쪽만 고쳐진다
  return toMinor(v)
}

/** 수량은 소수를 쓴다(1.5 M/M). 저장은 문자열로 넘긴다 — 부동소수를 거치지 않기 위해서다 */
function decimalOrNull(v: string | number | null | undefined, field: string, label: string): string | null {
  if (v === null || v === undefined || v === '') return null
  assertNumber(v, field, label)
  return String(v)
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
  return withCrmTx(workspaceId, (tx) => insertCost(tx, workspaceId, actorId, dealId, input))
}

/**
 * 여러 줄을 **한 번에** 넣는다 — 받은 견적서 한 건이 원가 여러 줄이 되는 길.
 *
 * **왜 한 트랜잭션인가**: 견적서 한 건은 사람에게 **한 덩어리**다. 줄마다 따로 넣으면
 * 다섯째 줄에서 실패했을 때 앞의 넷이 남고, 사람은 무엇이 들어갔는지 모른 채
 * 다시 올려 **같은 원가를 두 벌** 만든다. 되돌릴 수 없는 쪽으로 기우는 설계는 쓰지 않는다.
 *
 * 창구 하나가 낱개와 묶음을 모두 받는다 — 게이트(`cost.edit`)를 두 곳에 두지 않기 위해서다.
 */
export async function createDealCosts(
  workspaceId: string, actorId: string | null, dealId: string, inputs: readonly DealCostInput[],
): Promise<DealCostRow[]> {
  if (inputs.length === 0) {
    throw new CrmError('VALIDATION_FAILED', '넣을 원가 항목이 없습니다.', { field: 'items' })
  }
  if (inputs.length > MAX_COST_BATCH) {
    throw new CrmError('VALIDATION_FAILED', `원가는 한 번에 ${MAX_COST_BATCH}건까지 넣을 수 있어요.`, { field: 'items' })
  }
  return withCrmTx(workspaceId, async (tx) => {
    const rows: DealCostRow[] = []
    for (const input of inputs) rows.push(await insertCost(tx, workspaceId, actorId, dealId, input))
    return rows
  })
}

/** 한 번에 넣을 수 있는 줄 수 — 견적서 한 장의 항목 수보다 넉넉하되 무한은 아니다 */
export const MAX_COST_BATCH = 200

/** 한 줄 넣기 — 낱개와 묶음이 **같은 검사·같은 계산**을 지나게 하는 자리 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertCost(
  tx: any, workspaceId: string, actorId: string | null, dealId: string, input: DealCostInput,
): Promise<DealCostRow> {
  const name = (input.name ?? '').trim()
  if (!name) throw new CrmError('VALIDATION_FAILED', '항목 이름을 입력해 주세요.', { field: 'name' })

  const category = assertEnum(input.category, COST_CATEGORY_ORDER, 'EXPENSE', 'category')
  const stage = assertEnum(input.stage, COST_STAGE_ORDER, 'ESTIMATE', 'stage')
  const inputMode = assertEnum(input.inputMode, ['AMOUNT', 'EFFORT', 'RATIO'] as const, 'AMOUNT', 'inputMode')

  const gradeUnitMinor = await gradeCost(tx, input.laborGradeId)
  /*
    금액은 **서버가 계산한다.** 화면이 보낸 값을 그대로 저장하면 공수·단가와
    금액이 어긋난 행이 생기고, 합계는 맞는데 내역이 안 맞는 상태가 된다.
  */
  const amountMinor = computeCostAmount({
    category, stage, inputMode,
    amountMinor: input.amountMinor,
    effortMm: input.effortMm,
    gradeCostPerMmMinor: gradeUnitMinor,
    ratioPct: input.ratioPct,
    ratioBase: (input.ratioBase as 'REVENUE' | 'COST' | null) ?? null,
  })

  const currency = assertCurrency(input.currency)
  const kind = assertEnum(input.kind ?? undefined, LINE_KIND_ORDER, 'QUANTITY', 'kind')
  const fx = await stampFx(currency)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (tx as any).crmDealCost.create({
    data: {
      workspaceId, dealId, name,
      quoteLineId: input.quoteLineId || null,
      category, stage, inputMode,
      descriptionMd: (input.descriptionMd ?? '').trim() || null,
      amountMinor,
      currency,
      ...fx,
      kind,
      quantity: decimalOrNull(input.quantity, 'quantity', LINE_KIND_QUANTITY_LABEL[kind]),
      unit: (input.unit ?? '').trim() || null,
      unitPriceMinor: minorOrNull(input.unitPriceMinor, 'unitPriceMinor', LINE_KIND_PRICE_LABEL[kind]),
      remark: (input.remark ?? '').trim() || null,
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
    afterJson: { name, category, stage, amountMinor: amountMinor.toString(), currency },
  })
  return row
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
    const gradeUnitMinor = await gradeCost(tx, gradeId)

    const amountMinor = computeCostAmount({
      category, stage, inputMode,
      amountMinor: input.amountMinor !== undefined ? input.amountMinor : before.amountMinor,
      effortMm: input.effortMm !== undefined ? input.effortMm : (before.effortMm as number | null),
      gradeCostPerMmMinor: gradeUnitMinor,
      ratioPct: input.ratioPct !== undefined ? input.ratioPct : (before.ratioPct as number | null),
      ratioBase: (input.ratioBase ?? before.ratioBase) as 'REVENUE' | 'COST' | null,
    })

    /*
      **통화를 바꿀 때만 환율을 다시 박는다.**

      통화가 그대로인데 다시 받으면 어제 본 마진이 오늘 달라진다 — 아무도 손대지 않은
      원가가 아침에 바뀌어 있는 상태다. 반대로 통화를 고쳤는데 옛 환율이 남으면
      달러 금액에 엔화 환율이 붙는다. **바뀐 사실만 따라간다.**
    */
    const currency = assertCurrency(input.currency, before.currency)
    const fx = currency === before.currency ? null : await stampFx(currency)
    // 라벨은 **고친 뒤의 종류**로 말한다 — M/M 짜리 줄에 「수량」이라 하면 사람이 다른 칸을 본다
    const kind = assertEnum(input.kind ?? before.kind, LINE_KIND_ORDER, before.kind, 'kind')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any).crmDealCost.update({
      where: { id },
      data: {
        name: input.name !== undefined ? (input.name.trim() || before.name) : undefined,
        category, stage, inputMode,
        descriptionMd: input.descriptionMd !== undefined ? (input.descriptionMd?.trim() || null) : undefined,
        amountMinor,
        currency,
        ...(fx ?? {}),
        kind: input.kind !== undefined ? kind : undefined,
        quantity: input.quantity !== undefined ? decimalOrNull(input.quantity, 'quantity', LINE_KIND_QUANTITY_LABEL[kind]) : undefined,
        unit: input.unit !== undefined ? ((input.unit ?? '').trim() || null) : undefined,
        unitPriceMinor: input.unitPriceMinor !== undefined
          ? minorOrNull(input.unitPriceMinor, 'unitPriceMinor', LINE_KIND_PRICE_LABEL[kind])
          : undefined,
        remark: input.remark !== undefined ? ((input.remark ?? '').trim() || null) : undefined,
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
      beforeJson: { amountMinor: before.amountMinor.toString(), currency: before.currency },
      afterJson: { amountMinor: amountMinor.toString(), currency },
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
    /*
      **환율과 단가도 실어 보낸다.** 서버가 안 주면 화면은 통화만 알고 환산은 못 한다 —
      그러면 「$1,080.00」 옆에 원화가 비고, 사람은 그 금액이 큰지 작은지 모른다.
      고시일은 날짜만 보낸다(시각은 뜻이 없고, 화면이 또 자르게 만들 뿐이다).
    */
    fxRate: r.fxRate === null || r.fxRate === undefined ? null : String(r.fxRate),
    fxDate: r.fxDate ? r.fxDate.toISOString().slice(0, 10) : null,
    quantity: r.quantity === null || r.quantity === undefined ? null : String(r.quantity),
    unitPriceMinor: r.unitPriceMinor === null ? null : r.unitPriceMinor.toString(),
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
