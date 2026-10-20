/**
 * 가격 기준 품목 — 순서와 묶음, 여러 개 한꺼번에, 복제 (서비스)
 *
 * 화면에서 끌어 놓아 순서를 바꾸고 다른 묶음으로 옮긴 결과를 한 번에 저장한다.
 * 한 트랜잭션이라 중간에 실패하면 하나도 안 남는다 — 반쯤 옮겨진 순서는 사람이 못 알아본다.
 *
 * 지키는 것
 *   · 이 제품의 품목만 받는다. 다른 제품 품목이 섞이면 통째로 거절한다
 *   · 묶음 이름은 제품의 묶음 목록 안에서만 — 없는 묶음으로 옮기면 비율 대상이 흐려진다
 *   · 품목은 지우지 않고 판매 중지한다. 지난 견적이 가리키는 품목이 사라지면 안 된다
 */

import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { sectionsOf, itemFromRow, itemToData } from './pricebook-map.ts'
import { recordPrice } from './pricebook-history.ts'
import { ITEM_SELECT } from './pricebook.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export const MAX_BULK = 200

export interface OrderEntry {
  id: string
  section: string
  position: number
}

export type BulkAction = 'stop' | 'resume' | 'confirm' | 'move' | 'duplicate'
export const BULK_ACTIONS: readonly BulkAction[] = ['stop', 'resume', 'confirm', 'move', 'duplicate']

/** 순서 저장 입력을 본다 (순수 함수). 틀리면 사람이 읽을 사유, 맞으면 null */
export function orderProblem(
  productItemIds: ReadonlySet<string>,
  sectionNames: ReadonlySet<string>,
  order: readonly OrderEntry[],
): string | null {
  if (order.length === 0) return '옮길 품목이 없어요.'
  if (order.length > MAX_BULK) return `한 번에 ${MAX_BULK}개까지 옮길 수 있어요.`
  const seen = new Set<string>()
  for (const o of order) {
    if (!productItemIds.has(o.id)) return '이 제품의 품목이 아닌 것이 섞여 있어요.'
    if (seen.has(o.id)) return '같은 품목이 두 번 들어 있어요.'
    seen.add(o.id)
    if (!sectionNames.has(o.section)) return `없는 묶음이에요: ${o.section}`
    if (!Number.isInteger(o.position) || o.position < 0) return '순서 값이 틀렸어요.'
  }
  return null
}

/** 화면이 보낸 순서 목록을 거른다 */
export function parseOrder(v: unknown): OrderEntry[] {
  if (!Array.isArray(v)) throw new CrmError('VALIDATION_FAILED', '순서 목록이 필요해요.', { field: 'order' })
  return v.slice(0, MAX_BULK + 1).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { id: String(o.id ?? '').slice(0, 60), section: String(o.section ?? '').trim().slice(0, 100), position: Number(o.position) }
  })
}

export async function saveItemOrder(workspaceId: string, actorId: string | null, productId: string, order: readonly OrderEntry[]): Promise<void> {
  await withCrmTx(workspaceId, async (tx: Tx) => {
    const p = await tx.crmPriceProduct.findFirst({ where: { id: productId }, select: { id: true, sections: true } })
    if (!p) throw new CrmError('NOT_FOUND', '제품을 찾을 수 없습니다.')
    const items: { id: string; section: string | null }[] = await tx.crmProduct.findMany({ where: { priceProductId: productId }, select: { id: true, section: true } })
    const names = new Set([...sectionsOf(p.sections).map((s) => s.name), ...items.map((i) => i.section).filter((s): s is string => Boolean(s))])
    const problem = orderProblem(new Set(items.map((i) => i.id)), names, order)
    if (problem) throw new CrmError('VALIDATION_FAILED', problem, { field: 'order' })
    for (const o of order) {
      await tx.crmProduct.update({ where: { id: o.id }, data: { position: o.position, section: o.section } })
    }
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'price_item.reordered', targetType: 'price_product', targetId: productId, afterJson: order })
  })
}

export interface BulkInput {
  productId: string
  ids: string[]
  action: BulkAction
  /** move 일 때 옮길 묶음 */
  section?: string | null
}

export function parseBulk(v: unknown): BulkInput {
  const b = (v ?? {}) as Record<string, unknown>
  const action = String(b.action ?? '') as BulkAction
  if (!BULK_ACTIONS.includes(action)) throw new CrmError('VALIDATION_FAILED', '모르는 작업이에요.', { field: 'action' })
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_BULK + 1) : []
  if (ids.length === 0) throw new CrmError('VALIDATION_FAILED', '고른 품목이 없어요.', { field: 'ids' })
  if (ids.length > MAX_BULK) throw new CrmError('VALIDATION_FAILED', `한 번에 ${MAX_BULK}개까지예요.`, { field: 'ids' })
  const productId = String(b.productId ?? '')
  if (!productId) throw new CrmError('VALIDATION_FAILED', '제품이 필요해요.', { field: 'productId' })
  const section = typeof b.section === 'string' ? b.section.trim().slice(0, 100) : null
  if (action === 'move' && !section) throw new CrmError('VALIDATION_FAILED', '옮길 묶음을 고르세요.', { field: 'section' })
  return { productId, ids: [...new Set(ids)], action, section }
}

/** 복제한 이름 — 「STD」 → 「STD 복사본」, 이미 있으면 「STD 복사본 2」 */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  const base = `${name} 복사본`
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
  return `${base} ${Date.now()}`
}

export async function bulkItems(workspaceId: string, actorId: string | null, input: BulkInput): Promise<{ count: number; created: string[] }> {
  return withCrmTx(workspaceId, async (tx: Tx) => {
    const rows = await tx.crmProduct.findMany({ where: { id: { in: input.ids }, priceProductId: input.productId }, select: ITEM_SELECT })
    if (rows.length !== input.ids.length) throw new CrmError('VALIDATION_FAILED', '이 제품의 품목이 아닌 것이 섞여 있어요.', { field: 'ids' })
    const created: string[] = []
    if (input.action === 'stop' || input.action === 'resume') {
      await tx.crmProduct.updateMany({ where: { id: { in: input.ids } }, data: { isActive: input.action === 'resume' } })
    } else if (input.action === 'confirm') {
      for (const r of rows.filter((x: { needsReview: boolean }) => x.needsReview)) {
        await tx.crmProduct.update({ where: { id: r.id }, data: { needsReview: false } })
        await recordPrice(tx, workspaceId, actorId, { targetType: 'ITEM', targetId: r.id, field: 'confirmed', amountMinor: BigInt(r.unitPriceMinor), sourceKind: 'HAND' })
      }
    } else if (input.action === 'move') {
      const p = await tx.crmPriceProduct.findFirst({ where: { id: input.productId }, select: { sections: true } })
      if (!sectionsOf(p?.sections).some((s) => s.name === input.section)) throw new CrmError('VALIDATION_FAILED', `없는 묶음이에요: ${input.section}`, { field: 'section' })
      await tx.crmProduct.updateMany({ where: { id: { in: input.ids } }, data: { section: input.section } })
    } else {
      const all: { name: string; position: number }[] = await tx.crmProduct.findMany({ where: { priceProductId: input.productId }, select: { name: true, position: true } })
      const taken = new Set(all.map((x) => x.name))
      let pos = Math.max(0, ...all.map((x) => x.position)) + 1
      for (const r of rows) {
        const item = itemFromRow(r)
        const name = copyName(item.name, taken)
        taken.add(name)
        const made = await tx.crmProduct.create({
          data: { workspaceId, currency: 'KRW', ...itemToData({ ...item, name }, pos), priceProductId: input.productId, aliases: [] },
          select: { id: true },
        })
        pos += 1
        created.push(made.id)
        await recordPrice(tx, workspaceId, actorId, { targetType: 'ITEM', targetId: made.id, field: 'listPrice', amountMinor: item.listPriceMinor, sourceKind: 'HAND' })
      }
    }
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: `price_item.${input.action}`, targetType: 'price_product', targetId: input.productId, afterJson: { ids: input.ids, section: input.section ?? null, created } })
    return { count: rows.length, created }
  })
}
