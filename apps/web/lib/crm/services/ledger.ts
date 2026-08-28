/**
 * 매출 인식 장부 서비스 — 재원 · 현물 · 수주 매출
 *
 * **경계**: 견적(crm_quote)은 «고객에게 나가는 문서»이고 이 파일은 «우리 장부»다.
 * 현물은 협약서·정산 서류의 언어이지 견적서의 언어가 아니다.
 * 그래서 여기 있고, 견적 서비스는 현물을 모른다.
 *
 * **쓰기는 한 곳뿐이다**: 현물 명세가 바뀌면 `recalcLedger` 가
 * `inKindTotalMinor`·`bookedNetMinor` 를 다시 계산해 저장한다.
 * 화면이 뺄셈을 하지 않고, 두 값이 어긋날 자리가 없다.
 */

import type { CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText, requireText } from '../domain/normalize.ts'
import {
  computeBooked, pickBooked, isCashInflow, countsAsAccountingRevenue,
  needsSeparateAccount, FUNDING_LABEL,
  type FundingSourceType, type BookedAmounts, type BookedFrom, BOOKED_FROM_LABEL,
} from '../domain/booked-amount.ts'
import { checkI9, assertNoViolation } from '../domain/invariants.ts'
import { canView, hasCapability, type Viewer } from '../security/sensitivity.ts'
import { sumByYear, monthSpan, type PeriodAllocation } from '../domain/allocation.ts'
import type { TaxBasis } from '../domain/money.ts'

import { IN_KIND_LABEL, IN_KIND_BASIS_HINT, type InKindKindKey } from '../../terms/ledger.ts'

export type InKindKind = InKindKindKey

/** 말은 용어집이 정한다(§0-2) — 여기서 다시 적지 않고 그대로 내보낸다 */
export { IN_KIND_LABEL, IN_KIND_BASIS_HINT }

export interface InKindRow {
  id: string
  kind: InKindKind
  name: string
  valueMinor: bigint
  quantity: string | null
  unit: string | null
  basisNote: string | null
  startDate: Date | null
  endDate: Date | null
  position: number
}

export interface FundingRow {
  id: string
  sourceType: FundingSourceType
  amountMinor: bigint
  agencyName: string | null
  startDate: Date | null
  endDate: Date | null
  position: number
  /** 종류에서 파생된다 — 저장하지 않는다 */
  isCashInflow: boolean
  countsAsAccountingRevenue: boolean
  needsSeparateAccount: boolean
  label: string
}

export interface Ledger extends BookedAmounts {
  dealId: string
  taxBasis: TaxBasis
  taxRatePct: string
  /** 딜의 통화 — 화면이 「원」을 붙이지 않게 함께 보낸다 */
  currency: string | null
  bookedFrom: BookedFrom
  budgetMinor: bigint | null
  contractMinor: bigint | null
  funding: FundingRow[]
  inKind: InKindRow[]
  /** 현물의 연차 배분 — 기간에서 계산한다 */
  inKindByYear: PeriodAllocation[]
  /** 기간이 없어 배분하지 못한 현물 */
  inKindUndatedMinor: bigint
}

function decorate(f: {
  id: string; sourceType: string; amountMinor: bigint; agencyName: string | null
  startDate: Date | null; endDate: Date | null; position: number
}): FundingRow {
  const t = f.sourceType as FundingSourceType
  return {
    id: f.id, sourceType: t, amountMinor: f.amountMinor, agencyName: f.agencyName,
    startDate: f.startDate, endDate: f.endDate, position: f.position,
    isCashInflow: isCashInflow(t),
    countsAsAccountingRevenue: countsAsAccountingRevenue(t),
    needsSeparateAccount: needsSeparateAccount(t),
    label: FUNDING_LABEL[t],
  }
}

/**
 * 딜의 장부를 통째로 읽는다.
 *
 * 화면은 이 하나만 부르고 뺄셈·합계를 하지 않는다 —
 * 근거는 견적을 열 때 한 번에 오는 것과 같은 이유다(결정 32).
 */
export async function getLedger(db: CrmDb, dealId: string): Promise<Ledger> {
  const deal = await db.crmDeal.findFirst({
    where: { id: dealId },
    select: {
      id: true, taxBasis: true, taxRatePct: true,
      budgetNetMinor: true, quotedNetMinor: true, contractNetMinor: true,
      bookedNetMinor: true, inKindTotalMinor: true, amountMinor: true, currency: true,
    },
  })
  if (!deal) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

  const [funding, inKind] = await Promise.all([
    db.crmFundingSource.findMany({ where: { dealId }, orderBy: { position: 'asc' } }),
    db.crmInKind.findMany({ where: { dealId }, orderBy: { position: 'asc' } }),
  ])

  const picked = pickBooked(deal)
  const amounts = computeBooked({
    amountMinor: picked.minor,
    taxBasis: deal.taxBasis as TaxBasis,
    taxRatePct: String(deal.taxRatePct),
    inKind: inKind.map((k) => ({ valueMinor: k.valueMinor })),
    funding: funding.map((f) => ({ sourceType: f.sourceType as FundingSourceType, amountMinor: f.amountMinor })),
  })

  const byYear = sumByYear(inKind.map((k) => ({
    amountMinor: k.valueMinor, startDate: k.startDate, endDate: k.endDate,
  })))

  return {
    ...amounts,
    dealId,
    taxBasis: deal.taxBasis as TaxBasis,
    taxRatePct: String(deal.taxRatePct),
    currency: deal.currency ?? null,
    bookedFrom: picked.from,
    budgetMinor: deal.budgetNetMinor,
    contractMinor: deal.contractNetMinor,
    funding: funding.map(decorate),
    inKind: inKind.map((k) => ({
      id: k.id, kind: k.kind as InKindKind, name: k.name, valueMinor: k.valueMinor,
      quantity: k.quantity === null ? null : String(k.quantity),
      unit: k.unit, basisNote: k.basisNote,
      startDate: k.startDate, endDate: k.endDate, position: k.position,
    })),
    inKindByYear: byYear.years,
    inKindUndatedMinor: byYear.undatedMinor,
  }
}

/**
 * 파생값을 다시 계산해 저장한다 — **유일한 쓰기 경로**.
 *
 * 현물이 총액을 넘으면 여기서 막는다(I9). 화면이 아니라 여기서 막는 이유는
 * API 를 직접 두드려도 같은 답이 나와야 하기 때문이다.
 */
export async function recalcLedger(db: CrmDb, dealId: string, actorId?: string | null): Promise<Ledger> {
  const deal = await db.crmDeal.findFirst({
    where: { id: dealId },
    select: {
      id: true, workspaceId: true, bookedNetMinor: true, inKindTotalMinor: true,
      budgetNetMinor: true, quotedNetMinor: true, contractNetMinor: true, amountMinor: true,
    },
  })
  if (!deal) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

  const inKind = await db.crmInKind.findMany({ where: { dealId }, select: { valueMinor: true } })
  const inKindTotal = inKind.reduce<bigint>((a, k) => a + k.valueMinor, BigInt(0))
  const picked = pickBooked(deal)

  assertNoViolation(checkI9(inKindTotal, picked.minor))

  // 파이프라인 총액이 출렁이는 이유를 나중에 설명할 수 있어야 한다.
  // **갱신 전에** 만든다 — 뒤에 만들면 이미 같아진 값을 비교하게 된다.
  const logs: { field: string; from: bigint | null; to: bigint | null }[] = []
  if (deal.inKindTotalMinor !== inKindTotal) logs.push({ field: 'inKind', from: deal.inKindTotalMinor, to: inKindTotal })
  if (deal.bookedNetMinor !== picked.minor) logs.push({ field: 'booked', from: deal.bookedNetMinor, to: picked.minor })

  if (logs.length > 0) {
    await db.crmDeal.update({
      where: { id: dealId },
      data: { inKindTotalMinor: inKindTotal, bookedNetMinor: picked.minor },
    })
    {
      await db.crmDealAmountHistory.createMany({
        data: logs.map((l) => ({
          workspaceId: deal.workspaceId, dealId,
          field: l.field, fromMinor: l.from, toMinor: l.to,
          reason: `장부 재계산 (${picked.from})`, changedById: actorId ?? null,
        })),
      })
    }
  }
  return getLedger(db, dealId)
}

export interface InKindInputDto {
  kind: InKindKind
  name: string
  valueMinor: bigint | number | string
  quantity?: number | string | null
  unit?: string | null
  basisNote?: string | null
  startDate?: string | Date | null
  endDate?: string | Date | null
}

function toBig(v: bigint | number | string): bigint {
  if (typeof v === 'bigint') return v
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) throw new CrmError('VALIDATION_FAILED', '금액이 숫자가 아닙니다.')
  if (n < 0) throw new CrmError('VALIDATION_FAILED', '금액은 0보다 작을 수 없습니다.')
  return BigInt(Math.round(n)) // minor-ok — 여기는 잘못된 입력에 «던져야» 한다. toMinor 는 0 으로 삼킨다
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 저장하면 현물이 사업비를 넘는지 **미리** 본다.
 *
 * `recalcLedger` 의 검사는 마지막 방어선일 뿐이다 — 거기서 던지면
 * **행은 이미 저장된 뒤**라 잘못된 값이 그대로 남는다.
 * 실브라우저에서 「현물 제외 −9.6억」이 그려진 것이 그 결과였다.
 */
async function assertFitsBooked(db: CrmDb, dealId: string, deltaMinor: bigint, excludeId?: string): Promise<void> {
  const deal = await db.crmDeal.findFirst({
    where: { id: dealId },
    select: {
      id: true, budgetNetMinor: true, quotedNetMinor: true,
      contractNetMinor: true, amountMinor: true,
    },
  })
  if (!deal) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')
  const rows = await db.crmInKind.findMany({ where: { dealId }, select: { id: true, valueMinor: true } })
  const others = rows.reduce<bigint>((a, r) => (r.id === excludeId ? a : a + r.valueMinor), BigInt(0))
  assertNoViolation(checkI9(others + deltaMinor, pickBooked(deal).minor))
}

/**
 * 기간 역전 검사.
 *
 * `monthSpan` 으로는 못 잡는다 — 그 함수는 0 나눗셈을 막으려 **1로 클램프**하므로
 * 뒤집힌 기간도 «1개월»로 보인다. 여기서는 날짜를 직접 본다.
 */
function assertRange(start: Date | null, end: Date | null): void {
  if (start && end && end.getTime() < start.getTime()) {
    throw new CrmError('VALIDATION_FAILED', '종료일이 시작일보다 앞섭니다.')
  }
}

/**
 * 필수 이름. `requireText` 는 정규화만 하고 빈 값을 null 로 돌려준다 —
 * 막는 것은 호출부의 몫이라 여기서 한 번만 정의한다.
 */
function mustName(v: string | null | undefined): string {
  const t = requireText(v)
  if (!t) throw new CrmError('VALIDATION_FAILED', '현물 이름을 입력해 주세요.')
  return t
}

/** 현물 한 줄 추가. 저장 뒤 파생값을 즉시 다시 계산한다 */
export async function addInKind(
  db: CrmDb, workspaceId: string, dealId: string, dto: InKindInputDto, actorId?: string | null,
): Promise<Ledger> {
  const name = mustName(dto.name)
  const value = toBig(dto.valueMinor)
  const start = toDate(dto.startDate)
  const end = toDate(dto.endDate)
  assertRange(start, end)
  await assertFitsBooked(db, dealId, value)
  const last = await db.crmInKind.findFirst({ where: { dealId }, orderBy: { position: 'desc' }, select: { position: true } })
  await db.crmInKind.create({
    data: {
      workspaceId, dealId, kind: dto.kind, name, valueMinor: value,
      quantity: dto.quantity === null || dto.quantity === undefined ? null : String(dto.quantity),
      unit: normalizeText(dto.unit ?? null),
      basisNote: normalizeText(dto.basisNote ?? null) ?? IN_KIND_BASIS_HINT[dto.kind],
      startDate: start, endDate: end,
      position: (last?.position ?? -1) + 1,
      createdById: actorId ?? null,
    },
  })
  return recalcLedger(db, dealId, actorId)
}

export async function updateInKind(
  db: CrmDb, dealId: string, id: string, dto: Partial<InKindInputDto>, actorId?: string | null,
): Promise<Ledger> {
  const cur = await db.crmInKind.findFirst({ where: { id, dealId } })
  if (!cur) throw new CrmError('NOT_FOUND', '현물 항목을 찾을 수 없습니다.')
  // 한쪽만 고쳐도 뒤집힐 수 있다 — 안 바꾼 쪽은 지금 값으로 본다
  assertRange(
    dto.startDate !== undefined ? toDate(dto.startDate) : (cur.startDate ?? null),
    dto.endDate !== undefined ? toDate(dto.endDate) : (cur.endDate ?? null),
  )
  if (dto.valueMinor !== undefined) {
    // 고치는 줄은 빼고 나머지 합에 새 값을 더해 본다
    await assertFitsBooked(db, dealId, toBig(dto.valueMinor), id)
  }
  await db.crmInKind.update({
    where: { id },
    data: {
      ...(dto.kind ? { kind: dto.kind } : {}),
      ...(dto.name !== undefined ? { name: mustName(dto.name) } : {}),
      ...(dto.valueMinor !== undefined ? { valueMinor: toBig(dto.valueMinor) } : {}),
      ...(dto.quantity !== undefined ? { quantity: dto.quantity === null ? null : String(dto.quantity) } : {}),
      ...(dto.unit !== undefined ? { unit: normalizeText(dto.unit) } : {}),
      ...(dto.basisNote !== undefined ? { basisNote: normalizeText(dto.basisNote) } : {}),
      ...(dto.startDate !== undefined ? { startDate: toDate(dto.startDate) } : {}),
      ...(dto.endDate !== undefined ? { endDate: toDate(dto.endDate) } : {}),
    },
  })
  return recalcLedger(db, dealId, actorId)
}

export async function removeInKind(db: CrmDb, dealId: string, id: string, actorId?: string | null): Promise<Ledger> {
  const cur = await db.crmInKind.findFirst({ where: { id, dealId }, select: { id: true } })
  if (!cur) throw new CrmError('NOT_FOUND', '현물 항목을 찾을 수 없습니다.')
  await db.crmInKind.delete({ where: { id } })
  return recalcLedger(db, dealId, actorId)
}

export interface FundingInputDto {
  sourceType: FundingSourceType
  amountMinor: bigint | number | string
  agencyName?: string | null
  startDate?: string | Date | null
  endDate?: string | Date | null
}

/**
 * 재원을 통째로 갈아 끼운다.
 *
 * 한 줄씩 고치지 않는 이유: 재원은 «구성»이라 합이 사업비와 맞아야 뜻이 있다.
 * 한 줄만 바꾸면 그 순간 합이 틀어지고, 그 상태를 저장할 이유가 없다.
 */
export async function setFunding(
  db: CrmDb, workspaceId: string, dealId: string, rows: readonly FundingInputDto[], actorId?: string | null,
): Promise<Ledger> {
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.sourceType)) {
      throw new CrmError('VALIDATION_FAILED', `재원 «${FUNDING_LABEL[r.sourceType]}»이 두 번 들어왔습니다. 종류마다 한 줄입니다.`)
    }
    seen.add(r.sourceType)
  }
  await db.crmFundingSource.deleteMany({ where: { dealId } })
  if (rows.length > 0) {
    await db.crmFundingSource.createMany({
      data: rows.map((r, i) => ({
        workspaceId, dealId, sourceType: r.sourceType, amountMinor: toBig(r.amountMinor),
        agencyName: normalizeText(r.agencyName ?? null),
        startDate: toDate(r.startDate), endDate: toDate(r.endDate), position: i,
      })),
    })
  }
  return recalcLedger(db, dealId, actorId)
}

/**
 * 화면으로 나가는 모양.
 *
 * **두 가지를 여기서 한다** — 라우트마다 다시 하면 한 곳이 빠진다:
 *   ① BigInt 를 문자열로 (JSON 은 BigInt 를 못 싣는다)
 *   ② 원가를 역산할 수 있는 값은 **권한이 없으면 빼고 보낸다** — 가리는 게 아니라 뺀다
 *
 * 현물 «합계»는 남고 «명세»만 빠진다. 합계로는 인건비 단가를 역산할 수 없다.
 */
export function toLedgerJson(l: Ledger, viewer: Viewer | null | undefined): Record<string, unknown> {
  const detail = canView(viewer, 'inKind.valueMinor')
  return {
    dealId: l.dealId,
    taxBasis: l.taxBasis,
    taxRatePct: l.taxRatePct,
    currency: l.currency,
    bookedFrom: l.bookedFrom,
    bookedFromLabel: BOOKED_FROM_LABEL[l.bookedFrom],
    bookedMinor: l.bookedMinor.toString(),
    netMinor: l.tax.netMinor.toString(),
    taxMinor: l.tax.taxMinor.toString(),
    grossMinor: l.tax.grossMinor.toString(),
    inKindMinor: l.inKindMinor.toString(),
    exInKindMinor: l.exInKindMinor.toString(),
    accountingRevenueMinor: l.accountingRevenueMinor === null ? null : l.accountingRevenueMinor.toString(),
    cashInflowMinor: l.cashInflowMinor === null ? null : l.cashInflowMinor.toString(),
    hasInKind: l.hasInKind,
    inKindRatioPct: l.inKindRatioPct,
    funding: l.funding.map((f) => ({
      id: f.id, sourceType: f.sourceType, label: f.label,
      amountMinor: f.amountMinor.toString(),
      agencyName: f.agencyName,
      startDate: f.startDate ? f.startDate.toISOString() : null,
      endDate: f.endDate ? f.endDate.toISOString() : null,
      isCashInflow: f.isCashInflow,
      countsAsAccountingRevenue: f.countsAsAccountingRevenue,
      needsSeparateAccount: f.needsSeparateAccount,
    })),
    /** 명세를 볼 수 없으면 배열 자체가 안 온다 — 화면이 «권한 없음»을 그린다 */
    inKind: detail
      ? l.inKind.map((k) => ({
          id: k.id, kind: k.kind, kindLabel: IN_KIND_LABEL[k.kind], name: k.name,
          valueMinor: k.valueMinor.toString(),
          quantity: k.quantity, unit: k.unit, basisNote: k.basisNote,
          startDate: k.startDate ? k.startDate.toISOString() : null,
          endDate: k.endDate ? k.endDate.toISOString() : null,
          position: k.position,
        }))
      : null,
    inKindCount: l.inKind.length,
    /** 화면이 역할로 다시 판정하지 않게 서버가 답한다 */
    canEdit: hasCapability(viewer, 'cost.edit'),
    budgetMinor: l.budgetMinor === null ? null : l.budgetMinor.toString(),
    contractMinor: l.contractMinor === null ? null : l.contractMinor.toString(),
    inKindByYear: l.inKindByYear.map((y) => ({ year: y.year, months: y.months, amountMinor: y.amountMinor.toString() })),
    inKindUndatedMinor: l.inKindUndatedMinor.toString(),
  }
}

export interface LedgerMetaInput {
  /** 원본이 공급가액인가 총액인가 — 이 한 칸이 방향을 기록하고 세 값은 계산된다 */
  taxBasis?: 'NET' | 'GROSS'
  taxRatePct?: number | string
  budgetNetMinor?: bigint | number | string | null
  contractNetMinor?: bigint | number | string | null
}

/**
 * 장부의 «기준»을 고친다 — 부가세 방향과 예산·계약 금액.
 *
 * **견적 금액은 여기서 못 고친다.** 그건 대표 견적에서 와야 하고(I8),
 * 손으로 고칠 수 있게 두면 견적과 딜이 서로를 반박한다.
 */
export async function updateLedgerMeta(
  db: CrmDb, dealId: string, dto: LedgerMetaInput, actorId?: string | null,
): Promise<Ledger> {
  const deal = await db.crmDeal.findFirst({
    where: { id: dealId },
    select: { id: true, workspaceId: true, budgetNetMinor: true, contractNetMinor: true },
  })
  if (!deal) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

  if (dto.taxRatePct !== undefined) {
    const n = Number(dto.taxRatePct)
    // 100%를 넘는 세율은 입력 실수다 — 조용히 받으면 총액이 두 배가 된다
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new CrmError('VALIDATION_FAILED', '부가세율은 0에서 100 사이로 입력해 주세요.')
    }
  }

  const budget = dto.budgetNetMinor === undefined ? undefined
    : dto.budgetNetMinor === null || dto.budgetNetMinor === '' ? null : toBig(dto.budgetNetMinor)
  const contract = dto.contractNetMinor === undefined ? undefined
    : dto.contractNetMinor === null || dto.contractNetMinor === '' ? null : toBig(dto.contractNetMinor)

  // 금액이 바뀌면 왜 바뀌었는지 남긴다 — 파이프라인 총액이 출렁이는 이유다
  const logs: { field: string; from: bigint | null; to: bigint | null }[] = []
  if (budget !== undefined && budget !== deal.budgetNetMinor) logs.push({ field: 'budget', from: deal.budgetNetMinor, to: budget })
  if (contract !== undefined && contract !== deal.contractNetMinor) logs.push({ field: 'contract', from: deal.contractNetMinor, to: contract })

  await db.crmDeal.update({
    where: { id: dealId },
    data: {
      ...(dto.taxBasis ? { taxBasis: dto.taxBasis } : {}),
      ...(dto.taxRatePct !== undefined ? { taxRatePct: String(dto.taxRatePct) } : {}),
      ...(budget !== undefined ? { budgetNetMinor: budget } : {}),
      ...(contract !== undefined ? { contractNetMinor: contract } : {}),
    },
  })

  if (logs.length > 0) {
    await db.crmDealAmountHistory.createMany({
      data: logs.map((l) => ({
        workspaceId: deal.workspaceId, dealId,
        field: l.field, fromMinor: l.from, toMinor: l.to,
        reason: '장부 수정', changedById: actorId ?? null,
      })),
    })
  }
  return recalcLedger(db, dealId, actorId)
}
