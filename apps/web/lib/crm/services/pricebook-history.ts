/**
 * 가격 이력 — 정상가와 등급 단가의 흐름
 *
 * 감사 기록은 「누가 무엇을 바꿨나」를 남기는 곳이라 품목 하나의 금액 흐름을 꺼내 비교하기에는 맞지 않다.
 * 그래서 값이 날짜와 함께 줄로 쌓인다. 고치기와 지우기는 DB 트리거가 막는다(마이그 310).
 *
 * 1년 뒤에 열어도 같은 답: 견적의 기준 날짜로 `priceAt` 을 부르면 그날 값이 나온다.
 */

import type { CrmDb } from '../db/client.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export type PriceSourceKind = 'HAND' | 'FILE' | 'SEED' | 'QUOTE'
export type PriceTargetType = 'ITEM' | 'LABOR_GRADE'
export type PriceField = 'listPrice' | 'pricePerMm' | 'costPerMm' | 'publicRate' | 'confirmed'

export interface PriceRecord {
  targetType: PriceTargetType
  targetId: string
  field: PriceField
  amountMinor: bigint | null
  sourceKind: PriceSourceKind
  sourceName?: string | null
  effectiveFrom?: Date | null
}

export async function recordPrice(tx: Tx, workspaceId: string, actorId: string | null, r: PriceRecord): Promise<void> {
  await tx.crmPriceHistory.create({
    data: {
      workspaceId,
      targetType: r.targetType,
      targetId: r.targetId,
      field: r.field,
      amountMinor: r.amountMinor,
      sourceKind: r.sourceKind,
      sourceName: r.sourceName ?? null,
      actorId,
      ...(r.effectiveFrom ? { effectiveFrom: r.effectiveFrom } : {}),
    },
  })
}

export interface PriceHistoryRow {
  id: string
  field: string
  amountMinor: bigint | null
  effectiveFrom: Date
  sourceKind: string
  sourceName: string | null
  actorId: string | null
  createdAt: Date
}

export async function listPriceHistory(db: CrmDb, targetType: PriceTargetType, targetId: string): Promise<PriceHistoryRow[]> {
  return (db as Tx).crmPriceHistory.findMany({
    where: { targetType, targetId },
    select: { id: true, field: true, amountMinor: true, effectiveFrom: true, sourceKind: true, sourceName: true, actorId: true, createdAt: true },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })
}

/**
 * 그날의 값 — 그날까지 적용된 줄 가운데 가장 늦은 것. 없으면 null.
 * 순수 함수로 떼어 둔다. DB 없이 「날짜에 따라 다른 값」을 시험할 수 있어야 한다.
 */
export function valueAt(rows: readonly Pick<PriceHistoryRow, 'field' | 'amountMinor' | 'effectiveFrom' | 'createdAt'>[], field: PriceField, at: Date): bigint | null {
  const day = at.toISOString().slice(0, 10)
  const hits = rows
    .filter((r) => r.field === field && r.effectiveFrom.toISOString().slice(0, 10) <= day)
    .sort((a, b) => (b.effectiveFrom.getTime() - a.effectiveFrom.getTime()) || (b.createdAt.getTime() - a.createdAt.getTime()))
  return hits[0]?.amountMinor ?? null
}

/** 제품 하나의 품목 전부의 흐름 — 상세의 「변경 이력」 탭. 품목 이름을 붙여 돌려준다 */
export async function listProductHistory(db: CrmDb, productId: string): Promise<(PriceHistoryRow & { itemName: string })[]> {
  const items: { id: string; name: string }[] = await (db as Tx).crmProduct.findMany({
    where: { priceProductId: productId }, select: { id: true, name: true },
  })
  if (items.length === 0) return []
  const nameOf = new Map(items.map((i) => [i.id, i.name]))
  const rows = await (db as Tx).crmPriceHistory.findMany({
    where: { targetType: 'ITEM', targetId: { in: items.map((i) => i.id) } },
    select: { id: true, targetId: true, field: true, amountMinor: true, effectiveFrom: true, sourceKind: true, sourceName: true, actorId: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
  })
  return rows.map((r: PriceHistoryRow & { targetId: string }) => ({ ...r, itemName: nameOf.get(r.targetId) ?? '' }))
}
