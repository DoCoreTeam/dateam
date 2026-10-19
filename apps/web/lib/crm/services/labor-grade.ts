/**
 * 인건비 등급 — 등급 단가의 원천 (서비스)
 *
 * 예전에는 만들기 창구 하나뿐이고 고치기, 숨기기, 관리 화면이 없어 0줄이었다.
 * 노임단가는 RFP 규칙에만 있었다. 이제 등급마다 원가, 판매 단가, 공표 노임단가를 담고
 * 단가가 바뀌면 가격 이력에 새 줄을 쌓는다.
 *
 * **원가는 대외비다.** 목록은 누구나 받지만 원가 칸은 `cost.view` 가 있을 때만 싣는다.
 * 견적 엔진은 판매 단가와 공표 노임단가만 쓴다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { assertUpdated, lockWhere, BUMP_VERSION } from '../db/optimistic.ts'
import { CrmError } from '../domain/errors.ts'
import { requireText, normalizeText } from '../domain/normalize.ts'
import { toMinor } from '../domain/money.ts'
import { recordPrice, type PriceSourceKind } from './pricebook-history.ts'
import type { LaborGradeRef } from '../domain/pricebook/basis-lines.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

const SELECT = {
  id: true, name: true, roleLabel: true, costPerMmMinor: true, pricePerMmMinor: true, publicRateMinor: true,
  effectiveFrom: true, currency: true, position: true, isActive: true, version: true, updatedAt: true,
} as const

export interface LaborGradeRow {
  id: string
  name: string
  roleLabel: string | null
  costPerMmMinor: bigint
  pricePerMmMinor: bigint | null
  publicRateMinor: bigint | null
  effectiveFrom: Date | null
  currency: string
  position: number
  isActive: boolean
  version: number
  updatedAt: Date
}

export async function listLaborGrades(db: CrmDb, opts: { includeHidden?: boolean } = {}): Promise<LaborGradeRow[]> {
  return (db as Tx).crmLaborGrade.findMany({
    where: opts.includeHidden ? {} : { isActive: true },
    select: SELECT,
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  })
}

/** 엔진이 받는 모양 — 판매 단가가 없으면 공표 노임단가를 판매 단가 자리에 두지 않는다(출처가 다르다) */
export function toGradeRefs(rows: readonly LaborGradeRow[]): LaborGradeRef[] {
  return rows.map((r) => ({ id: r.id, name: r.name, pricePerMmMinor: r.pricePerMmMinor }))
}

/** 화면으로 — 원가는 볼 수 있을 때만 */
export function toGradeJson(r: LaborGradeRow, canSeeCost: boolean): Record<string, unknown> {
  return {
    id: r.id, name: r.name, roleLabel: r.roleLabel, currency: r.currency, position: r.position,
    isActive: r.isActive, version: r.version, updatedAt: r.updatedAt.toISOString(),
    effectiveFrom: r.effectiveFrom ? r.effectiveFrom.toISOString().slice(0, 10) : null,
    pricePerMmMinor: r.pricePerMmMinor === null ? null : r.pricePerMmMinor.toString(),
    publicRateMinor: r.publicRateMinor === null ? null : r.publicRateMinor.toString(),
    ...(canSeeCost ? { costPerMmMinor: r.costPerMmMinor.toString() } : {}),
  }
}

export interface LaborGradeInput {
  name?: string | null
  roleLabel?: string | null
  costPerMmMinor?: string | number | null
  pricePerMmMinor?: string | number | null
  publicRateMinor?: string | number | null
  effectiveFrom?: string | null
  position?: number | null
}

function optMinor(v: string | number | null | undefined): bigint | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const m = toMinor(v)
  if (m < BigInt(0)) throw new CrmError('VALIDATION_FAILED', '단가는 0 이상이어야 해요.')
  return m
}

function optDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new CrmError('VALIDATION_FAILED', '적용 시작일이 날짜가 아니에요.', { field: 'effectiveFrom' })
  return d
}

const PRICE_FIELDS = [
  ['pricePerMmMinor', 'pricePerMm'],
  ['costPerMmMinor', 'costPerMm'],
  ['publicRateMinor', 'publicRate'],
] as const

async function recordChanges(
  tx: Tx, workspaceId: string, actorId: string | null, id: string,
  before: Partial<LaborGradeRow> | null, after: LaborGradeRow, kind: PriceSourceKind, sourceName: string | null,
): Promise<void> {
  for (const [col, field] of PRICE_FIELDS) {
    const a = after[col] as bigint | null
    const b = before ? (before[col] as bigint | null | undefined) ?? null : null
    if (before && String(a) === String(b)) continue
    // 만들 때 비어 있던 칸은 이력이 아니다. 원가 0 은 「모름」이라 이력에 적지 않는다
    if (!before && (a === null || (col === 'costPerMmMinor' && a === BigInt(0)))) continue
    await recordPrice(tx, workspaceId, actorId, {
      targetType: 'LABOR_GRADE', targetId: id, field, amountMinor: a, sourceKind: kind, sourceName,
      effectiveFrom: after.effectiveFrom ?? null,
    })
  }
}

export async function createLaborGradeTx(
  tx: Tx, workspaceId: string, actorId: string | null, input: LaborGradeInput, kind: PriceSourceKind = 'HAND', sourceName: string | null = null,
): Promise<LaborGradeRow> {
  const name = requireText(input.name)
  if (!name) throw new CrmError('VALIDATION_FAILED', '등급 이름을 입력해 주세요.', { field: 'name' })
  const row = await tx.crmLaborGrade.create({
    data: {
      workspaceId,
      name,
      roleLabel: normalizeText(input.roleLabel),
      costPerMmMinor: optMinor(input.costPerMmMinor) ?? BigInt(0),
      pricePerMmMinor: optMinor(input.pricePerMmMinor) ?? null,
      publicRateMinor: optMinor(input.publicRateMinor) ?? null,
      effectiveFrom: optDate(input.effectiveFrom) ?? null,
      position: Number(input.position ?? 0) || 0,
    },
    select: SELECT,
  })
  await recordChanges(tx, workspaceId, actorId, row.id, null, row, kind, sourceName)
  await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'labor_grade.created', targetType: 'labor_grade', targetId: row.id, afterJson: { name } })
  return row
}

export async function createLaborGrade(workspaceId: string, actorId: string | null, input: LaborGradeInput): Promise<LaborGradeRow> {
  return withCrmTx(workspaceId, (tx: Tx) => createLaborGradeTx(tx, workspaceId, actorId, input))
}

export async function updateLaborGradeTx(
  tx: Tx, workspaceId: string, actorId: string | null, id: string, version: number | null, input: LaborGradeInput,
  kind: PriceSourceKind = 'HAND', sourceName: string | null = null,
): Promise<LaborGradeRow> {
  const before = await tx.crmLaborGrade.findFirst({ where: { id }, select: SELECT })
  if (!before) throw new CrmError('NOT_FOUND', '등급을 찾을 수 없습니다.')
  const data: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = requireText(input.name)
    if (!name) throw new CrmError('VALIDATION_FAILED', '등급 이름을 입력해 주세요.', { field: 'name' })
    data.name = name
  }
  if (input.roleLabel !== undefined) data.roleLabel = normalizeText(input.roleLabel)
  for (const [col] of PRICE_FIELDS) {
    const v = optMinor(input[col])
    if (v !== undefined) data[col] = col === 'costPerMmMinor' ? (v ?? BigInt(0)) : v
  }
  const eff = optDate(input.effectiveFrom)
  if (eff !== undefined) data.effectiveFrom = eff
  if (input.position !== undefined && input.position !== null) data.position = Math.trunc(Number(input.position)) || 0
  const res = await tx.crmLaborGrade.updateMany({ where: version === null ? { id } : lockWhere(id, version), data: { ...data, ...BUMP_VERSION } })
  assertUpdated(res.count, { exists: true, version: before.version }, '등급')
  const after = await tx.crmLaborGrade.findFirst({ where: { id }, select: SELECT })
  await recordChanges(tx, workspaceId, actorId, id, before, after, kind, sourceName)
  await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'labor_grade.updated', targetType: 'labor_grade', targetId: id, afterJson: { name: after.name } })
  return after
}

export async function updateLaborGrade(
  workspaceId: string, actorId: string | null, id: string, version: number, input: LaborGradeInput,
): Promise<LaborGradeRow> {
  return withCrmTx(workspaceId, (tx: Tx) => updateLaborGradeTx(tx, workspaceId, actorId, id, version, input))
}

/** 숨기기 — 쓴 견적이 이 등급을 가리켜서 지우지 않는다 */
export async function setLaborGradeActive(workspaceId: string, actorId: string | null, id: string, active: boolean): Promise<void> {
  await withCrmTx(workspaceId, async (tx: Tx) => {
    const res = await tx.crmLaborGrade.updateMany({ where: { id }, data: { isActive: active, ...BUMP_VERSION } })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '등급을 찾을 수 없습니다.')
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: active ? 'labor_grade.shown' : 'labor_grade.hidden', targetType: 'labor_grade', targetId: id })
  })
}
