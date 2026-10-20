/**
 * 이 회사가 이미 산 품목 — 체결된 계약에서 (서비스)
 *
 * 「ENT 전환 구축」은 STD 를 쓰던 고객만 받는다. 그 고객인지는 사람의 기억이 아니라 지난 계약이 안다.
 * 같은 회사의 딜에서 체결(CONCLUDED)된 계약이 가리키는 견적의 줄을 모은다.
 * 해지·취소·초안 계약과 지운 딜·지운 계약은 뺀다 — 체결되지 않은 것은 산 것이 아니다.
 *
 * 읽기만 한다. 금액과 원가는 싣지 않는다 — 품목 id 와 근거 한 줄뿐.
 */

import type { CrmDb } from '../db/client.ts'
import { kstDateKey } from '../../datetime/kst.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export interface ContractRow {
  id: string
  title: string
  status: string
  concludedAt: Date | null
  deletedAt: Date | null
  quoteId: string | null
}

export interface OwnedItems {
  /** 이미 산 품목 id */
  itemIds: string[]
  /** 품목 id → 근거 한 줄(가장 최근 체결 계약) */
  evidence: Record<string, string>
}

export const EMPTY_OWNED: OwnedItems = { itemIds: [], evidence: {} }

/** 산 것으로 치는 계약인가 — 체결됐고 지우지 않았다 */
export function countsAsBought(c: Pick<ContractRow, 'status' | 'deletedAt'>): boolean {
  return c.status === 'CONCLUDED' && c.deletedAt === null
}

/** 계약과 견적 줄에서 이미 산 품목을 모은다 (순수 함수). 같은 품목이면 최근 체결 계약을 근거로 */
export function ownedFrom(contracts: readonly ContractRow[], linesByQuote: ReadonlyMap<string, readonly string[]>): OwnedItems {
  const bought = contracts
    .filter(countsAsBought)
    .sort((a, b) => (b.concludedAt?.getTime() ?? 0) - (a.concludedAt?.getTime() ?? 0))
  const evidence: Record<string, string> = {}
  for (const c of bought) {
    const note = `${c.concludedAt ? `${kstDateKey(c.concludedAt.toISOString())} 체결 ` : ''}${c.title}`
    for (const id of c.quoteId ? linesByQuote.get(c.quoteId) ?? [] : []) {
      if (!(id in evidence)) evidence[id] = note
    }
  }
  return { itemIds: Object.keys(evidence), evidence }
}

/** 딜에서 회사를 찾아 그 회사의 체결 계약을 읽는다. 회사가 없으면 빈 목록 */
export async function loadOwnedItemsForDeal(db: CrmDb, dealId: string | null | undefined): Promise<OwnedItems> {
  if (!dealId) return EMPTY_OWNED
  const deal = await (db as Tx).crmDeal.findFirst({ where: { id: dealId }, select: { companyId: true } })
  if (!deal?.companyId) return EMPTY_OWNED
  const contracts: ContractRow[] = await (db as Tx).crmContract.findMany({
    where: { status: 'CONCLUDED', deletedAt: null, deal: { companyId: deal.companyId, deletedAt: null } },
    select: { id: true, title: true, status: true, concludedAt: true, deletedAt: true, quoteId: true },
    orderBy: { concludedAt: 'desc' },
    take: 50,
  })
  const quoteIds = [...new Set(contracts.map((c) => c.quoteId).filter((q): q is string => Boolean(q)))]
  if (quoteIds.length === 0) return EMPTY_OWNED
  const lines: { quoteId: string; productId: string | null }[] = await (db as Tx).crmQuoteLine.findMany({
    where: { quoteId: { in: quoteIds }, productId: { not: null } },
    select: { quoteId: true, productId: true },
  })
  const byQuote = new Map<string, string[]>()
  for (const l of lines) {
    if (!l.productId) continue
    byQuote.set(l.quoteId, [...(byQuote.get(l.quoteId) ?? []), l.productId])
  }
  return ownedFrom(contracts, byQuote)
}
