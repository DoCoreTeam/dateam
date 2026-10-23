/**
 * 견적 저장과 보내기에 걸리는 가격 기준 일 두 가지 (서비스)
 *
 *   · 보내기 전 기준 대조 — 단가를 어느 길로도 못 찾은 줄(실사 후 견적)이 있으면 막는다
 *   · 처음 쓴 항목을 품목으로 — 견적 24줄 중 18줄이 그 견적에만 남고 다음 견적에서 다시 쳐졌다
 *
 * 품목은 이름과 규격이 **둘 다** 같을 때만 하나로 본다. CPU, RAM 처럼 이름은 같고 규격이 다른 줄이 있다.
 * 이름이 너무 넓은 줄(「기타」)과 비율 줄과 0원 줄은 품목으로 올리지 않는다.
 * 지난 견적은 건드리지 않는다 — 저장한 그 견적의 줄만 본다.
 */

import { CrmError } from '../domain/errors.ts'
import { baselineCheck, blocks, type BaselineFinding } from '../domain/pricebook/baseline-check.ts'
import { recordPrice } from './pricebook-history.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

const TOO_BROAD = new Set(['기타', '기타 항목', '항목', '품목'])
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()

export async function baselineFindings(tx: Tx, quoteId: string): Promise<BaselineFinding[]> {
  const lines = await tx.crmQuoteLine.findMany({
    where: { quoteId },
    orderBy: { position: 'asc' },
    select: { name: true, unitPriceMinor: true, listPriceMinor: true, priceSource: true, ratioPct: true, productId: true, provenance: true, priceProductId: true, priceProductRevision: true },
  })
  const ids = [...new Set(lines.map((l: { productId: string | null }) => l.productId).filter(Boolean))] as string[]
  const products: { id: string; unitPriceMinor: bigint }[] = ids.length
    ? await tx.crmProduct.findMany({ where: { id: { in: ids } }, select: { id: true, unitPriceMinor: true } })
    : []
  const now = new Map(products.map((p) => [p.id, BigInt(p.unitPriceMinor)]))
  const refIds = [...new Set(lines.map((l: { priceProductId: string | null }) => l.priceProductId).filter(Boolean))] as string[]
  const refs: { id: string; name: string; revision: number }[] = refIds.length
    ? await tx.crmPriceProduct.findMany({ where: { id: { in: refIds } }, select: { id: true, name: true, revision: true } })
    : []
  return baselineCheck(lines, now, new Map(refs.map((r) => [r.id, { revision: r.revision, name: r.name }])))
}

/** 보내기 전 — 막는 것이 하나라도 있으면 던진다. 알림은 화면이 보여 준다 */
export async function assertBaselineForSend(tx: Tx, quoteId: string): Promise<void> {
  const bad = blocks(await baselineFindings(tx, quoteId))
  if (bad.length === 0) return
  throw new CrmError('VALIDATION_FAILED', bad.map((b) => b.message).join(' '), { field: 'lines', reason: 'baseline' })
}

/** 처음 쓴 항목을 품목으로 등록하고 그 줄에 잇는다. 등록한 수를 돌려준다 */
export async function autoRegisterLines(tx: Tx, workspaceId: string, actorId: string | null, quoteId: string, currency: string): Promise<number> {
  const lines = await tx.crmQuoteLine.findMany({
    where: { quoteId, productId: null },
    select: { id: true, name: true, descriptionMd: true, unit: true, unitPriceMinor: true, taxRate: true, ratioPct: true, billing: true },
  })
  let made = 0
  for (const l of lines) {
    const name = String(l.name ?? '').trim()
    if (!name || TOO_BROAD.has(name) || l.ratioPct !== null || BigInt(l.unitPriceMinor) <= BigInt(0)) continue
    const spec = String(l.descriptionMd ?? '').split('\n')[0].trim() || null
    const candidates: { id: string; spec: string | null }[] = await tx.crmProduct.findMany({
      where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true, spec: true },
    })
    let productId = candidates.find((c) => norm(c.spec) === norm(spec))?.id ?? null
    if (!productId) {
      const p = await tx.crmProduct.create({
        data: {
          workspaceId, name, spec, unit: l.unit, unitPriceMinor: BigInt(l.unitPriceMinor), taxRate: l.taxRate,
          currency, billing: l.billing === 'ANNUAL' ? 'ANNUAL' : 'ONCE', autoRegistered: true, section: '기타',
        },
        select: { id: true },
      })
      await recordPrice(tx, workspaceId, actorId, { targetType: 'ITEM', targetId: p.id, field: 'listPrice', amountMinor: BigInt(l.unitPriceMinor), sourceKind: 'QUOTE' })
      productId = p.id
      made++
    }
    await tx.crmQuoteLine.update({ where: { id: l.id }, data: { productId } })
  }
  return made
}
