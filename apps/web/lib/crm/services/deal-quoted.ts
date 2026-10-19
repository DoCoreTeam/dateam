/**
 * 딜의 견적 금액 = 대표 견적의 1회분 공급가액 (불변식 I8)
 *
 * 스키마 주석은 「대표 견적에서 자동으로 온다」고 적어 두었지만 이 값을 쓰는 코드가 0곳이었다
 * (실측 2026-10-20: 견적이 있는 딜 4건 중 견적 금액이 있는 딜 0건). 그래서 리포트의 견적 금액 칸이 비었다.
 *
 * 대표 견적은 딜이 가리키는 primaryQuoteId 다. 없으면 지우지 않은 견적 가운데 거절·만료가 아닌
 * 가장 최근 것이다. **매년 금액은 안 섞는다** — 유지보수를 더하면 딜 금액과 리포트가 그만큼 부푼다.
 * 금액이 바뀌면 금액 이력에 한 줄을 남기고 장부를 다시 센다.
 */

import type { CrmDb } from '../db/client.ts'
import { recalcLedger } from './ledger.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

const LIVE_STATUS = ['DRAFT', 'SENT', 'ACCEPTED']

/** 1회분 공급가액 — 소계 − 할인 − 묶음 절사. 세금과 매년분은 안 넣는다 */
export function quotedNetOf(q: { subtotalMinor: bigint; discountMinor: bigint; sectionRoundingMinor?: bigint | null }): bigint {
  return BigInt(q.subtotalMinor) - BigInt(q.discountMinor) - BigInt(q.sectionRoundingMinor ?? 0)
}

export async function syncDealQuoted(tx: Tx, dealId: string, actorId: string | null): Promise<void> {
  const deal = await tx.crmDeal.findFirst({ where: { id: dealId }, select: { id: true, workspaceId: true, quotedNetMinor: true, primaryQuoteId: true } })
  if (!deal) return
  const select = { id: true, subtotalMinor: true, discountMinor: true, sectionRoundingMinor: true, status: true }
  const primary = deal.primaryQuoteId
    ? await tx.crmQuote.findFirst({ where: { id: deal.primaryQuoteId }, select })
    : null
  const quote = primary ?? await tx.crmQuote.findFirst({
    where: { dealId, status: { in: LIVE_STATUS } },
    orderBy: [{ updatedAt: 'desc' }],
    select,
  })
  const next = quote ? quotedNetOf(quote) : null
  const before = deal.quotedNetMinor === null ? null : BigInt(deal.quotedNetMinor)
  if (before === next) return
  await tx.crmDeal.update({ where: { id: dealId }, data: { quotedNetMinor: next } })
  await tx.crmDealAmountHistory.create({
    data: {
      workspaceId: deal.workspaceId, dealId, field: 'quoted', fromMinor: before, toMinor: next,
      reason: quote ? '대표 견적의 1회분 공급가액' : '견적이 없어 비움', sourceQuoteId: quote?.id ?? null, changedById: actorId,
    },
  })
  await recalcLedger(tx as CrmDb, dealId, actorId)
}
