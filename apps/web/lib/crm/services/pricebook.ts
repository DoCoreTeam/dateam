/**
 * 가격 기준 — 제품, 품목, 규칙 (서비스)
 *
 * 화면 한 벌(「가격 기준」)과 견적 엔진이 같이 쓴다. 계산은 하지 않는다 — DB 줄을 엔진 모양으로 바꿔
 * `solution-engine` 에 넘기고, 검증은 `validate.ts` 에 맡긴다.
 *
 * 지키는 것
 *   · 정상가를 고치면 가격 이력에 새 줄. 덮지 않는다(`pricebook-history.ts`)
 *   · 고치기는 버전 잠금 — 두 사람이 같이 고치면 뒤 사람이 거절된다
 *   · 제품 지우기는 휴지통, 품목 지우기는 판매 중지 — 지난 견적이 가리키는 품목이 사라지지 않는다
 *   · 모양이 틀린 규칙은 끈 채로 저장하고 사유를 남긴다
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { assertUpdated, lockWhere, BUMP_VERSION } from '../db/optimistic.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText, requireText } from '../domain/normalize.ts'
import type { PriceItem, PriceProduct, PriceRule, ProductSection, SolutionConditions } from '../domain/pricebook/types.ts'
import { buildSolutionQuote, type SolutionResult } from '../domain/pricebook/solution-engine.ts'
import { checkExamples, checkItems, checkRules, type ExampleCheck } from '../domain/pricebook/validate.ts'
import {
  toEngineProduct, itemToData, ruleToRow, examplesToJson, sectionsOf,
  type ItemDbRow, type ProductDbRow, type RuleDbRow,
} from './pricebook-map.ts'
import { recordPrice, type PriceSourceKind } from './pricebook-history.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

const PRODUCT_SELECT = {
  id: true, name: true, businessTypeKey: true, descriptionMd: true, sections: true,
  tcoYears: true, freeYears: true, examples: true, isActive: true, needsReview: true,
  sourceFileName: true, sourceAttachmentId: true, version: true, updatedAt: true, deletedAt: true,
} as const

export const ITEM_SELECT = {
  id: true, name: true, sku: true, unitPriceMinor: true, currency: true, taxRate: true, unit: true,
  descriptionMd: true, isActive: true, priceProductId: true, section: true, basis: true, billing: true,
  ratioPct: true, ratioOfSection: true, discountable: true, aliases: true, spec: true, remark: true,
  needsReview: true, autoRegistered: true, position: true, version: true, updatedAt: true,
} as const

const RULE_SELECT = { id: true, kind: true, body: true, isEnabled: true, disabledReason: true, position: true } as const

const LIST_LIMIT = 200

export interface ProductListRow {
  id: string
  name: string
  businessTypeKey: string
  itemCount: number
  ruleCount: number
  updatedAt: Date
  isActive: boolean
  needsReview: boolean
  deletedAt: Date | null
}

export interface ListPriceProductsInput {
  q?: string | null
  includeInactive?: boolean
  trash?: boolean
}

export async function listPriceProducts(db: CrmDb, input: ListPriceProductsInput = {}): Promise<ProductListRow[]> {
  const q = normalizeText(input.q)
  const where: Record<string, unknown> = input.trash ? { deletedAt: { not: null } } : {}
  if (!input.trash && !input.includeInactive) where.isActive = true
  if (q) where.name = { contains: q, mode: 'insensitive' }
  const rows = await (db as Tx).crmPriceProduct.findMany({
    where,
    select: { ...PRODUCT_SELECT, _count: { select: { items: true, rules: true } } },
    orderBy: [{ name: 'asc' }],
    take: LIST_LIMIT,
  })
  return rows.map((r: Tx) => ({
    id: r.id, name: r.name, businessTypeKey: r.businessTypeKey,
    itemCount: r._count.items, ruleCount: r._count.rules,
    updatedAt: r.updatedAt, isActive: r.isActive, needsReview: r.needsReview, deletedAt: r.deletedAt ?? null,
  }))
}

/** 제품에 안 묶인 품목 가운데 견적에서 자동 등록된 것의 수 — 목록의 「정리 전」 줄 */
export async function countUnsortedItems(db: CrmDb): Promise<number> {
  return (db as Tx).crmProduct.count({ where: { priceProductId: null, autoRegistered: true, isActive: true } })
}

export interface ProductDetail {
  product: ProductDbRow & { sourceFileName: string | null; updatedAt: Date; deletedAt: Date | null }
  items: (ItemDbRow & Record<string, unknown>)[]
  rules: (RuleDbRow & { id: string; disabledReason: string | null })[]
}

export async function getPriceProduct(db: CrmDb, id: string): Promise<ProductDetail> {
  const product = await (db as Tx).crmPriceProduct.findFirst({ where: { id }, select: PRODUCT_SELECT })
  if (!product) throw new CrmError('NOT_FOUND', '제품을 찾을 수 없습니다.')
  const [items, rules] = await Promise.all([
    (db as Tx).crmProduct.findMany({ where: { priceProductId: id }, select: ITEM_SELECT, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
    (db as Tx).crmPriceRule.findMany({ where: { productId: id }, select: RULE_SELECT, orderBy: [{ position: 'asc' }] }),
  ])
  return { product, items, rules }
}

/** 엔진에 넘길 제품 — 판매 중지 품목과 꺼 둔 규칙은 빠진다 */
export async function loadEngineProduct(db: CrmDb, id: string): Promise<PriceProduct> {
  const d = await getPriceProduct(db, id)
  return toEngineProduct(d.product, d.items, d.rules)
}

export interface PreviewResult {
  result: SolutionResult
  examples: ExampleCheck[]
}

/** 미리 계산 — 견적과 같은 엔진, 같은 제품 모양 */
export async function previewPriceProduct(db: CrmDb, id: string, conditions: SolutionConditions | null): Promise<PreviewResult> {
  const p = await loadEngineProduct(db, id)
  const cond = conditions ?? p.examples?.[0]?.conditions ?? { picked: [], gpus: [], nodes: null, training: null, companyKind: null, discount: 'none' }
  return { result: buildSolutionQuote(p, cond), examples: checkExamples(p) }
}

// ── 제품 만들기 고치기 지우기 ──────────────────────────────────────────────

export interface ProductInput {
  name?: string | null
  businessTypeKey?: string | null
  descriptionMd?: string | null
  sections?: ProductSection[] | null
  tcoYears?: number | null
  freeYears?: number | null
  isActive?: boolean
}

function sectionsData(v: ProductSection[] | null | undefined): ProductSection[] | undefined {
  if (v === undefined || v === null) return undefined
  return sectionsOf(v)
}

async function assertNameFree(tx: Tx, name: string, exceptId: string | null): Promise<void> {
  const clash = await tx.crmPriceProduct.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) throw new CrmError('VALIDATION_FAILED', `「${name}」은 이미 있는 제품입니다.`, { field: 'name' })
}

export async function createPriceProduct(workspaceId: string, actorId: string | null, input: ProductInput): Promise<{ id: string }> {
  const name = requireText(input.name)
  if (!name) throw new CrmError('VALIDATION_FAILED', '제품 이름을 입력해 주세요.', { field: 'name' })
  return withCrmTx(workspaceId, async (tx: Tx) => {
    await assertNameFree(tx, name, null)
    const made = await tx.crmPriceProduct.create({
      data: {
        workspaceId,
        name,
        businessTypeKey: normalizeText(input.businessTypeKey) || 'SOLUTION',
        descriptionMd: input.descriptionMd?.trim() || null,
        sections: sectionsData(input.sections) ?? [],
        tcoYears: clampYears(input.tcoYears, 5),
        freeYears: clampYears(input.freeYears, 1, 0),
        createdById: actorId,
      },
      select: { id: true },
    })
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'price_product.created', targetType: 'price_product', targetId: made.id, afterJson: { name } })
    return made
  })
}

function clampYears(v: number | null | undefined, fallback: number, min = 1): number {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(20, Math.max(min, n))
}

export async function updatePriceProduct(
  workspaceId: string, actorId: string | null, id: string, version: number, input: ProductInput,
): Promise<void> {
  await withCrmTx(workspaceId, async (tx: Tx) => {
    const before = await tx.crmPriceProduct.findFirst({ where: { id }, select: PRODUCT_SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '제품을 찾을 수 없습니다.')
    const data: Record<string, unknown> = {}
    if (input.name !== undefined) {
      const name = requireText(input.name)
      if (!name) throw new CrmError('VALIDATION_FAILED', '제품 이름을 입력해 주세요.', { field: 'name' })
      await assertNameFree(tx, name, id)
      data.name = name
    }
    if (input.businessTypeKey !== undefined) data.businessTypeKey = normalizeText(input.businessTypeKey) || 'SOLUTION'
    if (input.descriptionMd !== undefined) data.descriptionMd = input.descriptionMd?.trim() || null
    const sections = sectionsData(input.sections)
    if (sections) data.sections = sections
    if (input.tcoYears !== undefined) data.tcoYears = clampYears(input.tcoYears, before.tcoYears)
    if (input.freeYears !== undefined) data.freeYears = clampYears(input.freeYears, before.freeYears, 0)
    if (input.isActive !== undefined) data.isActive = input.isActive
    const res = await tx.crmPriceProduct.updateMany({ where: lockWhere(id, version), data: { ...data, ...BUMP_VERSION } })
    assertUpdated(res.count, { exists: true, version: before.version }, '제품')
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'price_product.updated', targetType: 'price_product', targetId: id, beforeJson: { name: before.name }, afterJson: data })
  })
}

export async function deletePriceProduct(workspaceId: string, actorId: string | null, id: string): Promise<void> {
  await withCrmTx(workspaceId, async (tx: Tx) => {
    const res = await tx.crmPriceProduct.updateMany({ where: { id }, data: { deletedAt: new Date(), ...BUMP_VERSION } })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '제품을 찾을 수 없습니다.')
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'price_product.deleted', targetType: 'price_product', targetId: id })
  })
}

/** 휴지통에서 되살린다 — 그사이 같은 이름의 제품이 생겼으면 막는다 */
export async function restorePriceProduct(workspaceId: string, actorId: string | null, id: string): Promise<void> {
  await withCrmTx(workspaceId, async (tx: Tx) => {
    const row = await tx.crmPriceProduct.findFirst({ where: { id, deletedAt: { not: null } }, select: { id: true, name: true } })
    if (!row) throw new CrmError('NOT_FOUND', '휴지통에서 제품을 찾을 수 없습니다.')
    await assertNameFree(tx, row.name, id)
    await tx.crmPriceProduct.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null, ...BUMP_VERSION } })
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'price_product.restored', targetType: 'price_product', targetId: id })
  })
}

// ── 품목 ──────────────────────────────────────────────────────────────────

/** 쓸 품목 — id 가 없으면 새로 만든다 */
export type ItemInput = Omit<PriceItem, 'id'> & { id?: string }

export interface ItemWriteOptions {
  sourceKind: PriceSourceKind
  sourceName?: string | null
}

/**
 * 품목을 쓴다 — id 가 있으면 고치고 없으면 만든다. 정상가가 바뀌면 가격 이력에 새 줄.
 * 엔진 모양(`PriceItem`)을 그대로 받아 파일 가져오기와 화면이 같은 길을 쓴다.
 */
export async function writeItemTx(
  tx: Tx, workspaceId: string, actorId: string | null, productId: string | null,
  item: ItemInput, position: number, opts: ItemWriteOptions,
): Promise<string> {
  const data: Record<string, unknown> = { ...itemToData({ ...item, id: item.id ?? '' }, position), priceProductId: productId }
  const name = requireText(item.name)
  if (!name) throw new CrmError('VALIDATION_FAILED', '품목 이름을 입력해 주세요.', { field: 'name' })
  const existing = item.id
    ? await tx.crmProduct.findFirst({ where: { id: item.id }, select: { id: true, unitPriceMinor: true, basis: true } })
    : null
  if (existing) {
    await tx.crmProduct.update({ where: { id: existing.id }, data: { ...data, ...BUMP_VERSION } })
    if (BigInt(existing.unitPriceMinor) !== BigInt(String(data.unitPriceMinor))) {
      await recordPrice(tx, workspaceId, actorId, { targetType: 'ITEM', targetId: existing.id, field: 'listPrice', amountMinor: item.listPriceMinor, ...opts })
    }
    return existing.id
  }
  const made = await tx.crmProduct.create({ data: { workspaceId, currency: 'KRW', ...data }, select: { id: true } })
  await recordPrice(tx, workspaceId, actorId, { targetType: 'ITEM', targetId: made.id, field: 'listPrice', amountMinor: item.listPriceMinor, ...opts })
  return made.id
}

export async function saveItem(
  workspaceId: string, actorId: string | null, productId: string | null, item: ItemInput, position: number,
): Promise<{ id: string }> {
  const problems = checkItems({ id: '', name: '', businessTypeKey: '', sections: [], items: [{ ...item, id: item.id ?? '' }], rules: [], tcoYears: 5, freeYears: 1 })
    .filter((p) => !p.message.includes('묶음'))
  if (problems.length > 0) throw new CrmError('VALIDATION_FAILED', problems[0].message)
  return withCrmTx(workspaceId, async (tx: Tx) => {
    const id = await writeItemTx(tx, workspaceId, actorId, productId, item, position, { sourceKind: 'HAND' })
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: item.id ? 'product.updated' : 'product.created', targetType: 'product', targetId: id, afterJson: { name: item.name, listPriceMinor: item.listPriceMinor?.toString() ?? null } })
    return { id }
  })
}

/** 확인 전 가격을 확인함으로 — 확인한 사람과 날짜가 가격 이력에 남는다 */
export async function confirmItem(workspaceId: string, actorId: string | null, itemId: string): Promise<void> {
  await withCrmTx(workspaceId, async (tx: Tx) => {
    const row = await tx.crmProduct.findFirst({ where: { id: itemId }, select: { id: true, unitPriceMinor: true, needsReview: true } })
    if (!row) throw new CrmError('NOT_FOUND', '품목을 찾을 수 없습니다.')
    if (!row.needsReview) return
    await tx.crmProduct.update({ where: { id: itemId }, data: { needsReview: false, ...BUMP_VERSION } })
    await recordPrice(tx, workspaceId, actorId, { targetType: 'ITEM', targetId: itemId, field: 'confirmed', amountMinor: BigInt(row.unitPriceMinor), sourceKind: 'HAND' })
  })
}

// ── 규칙 ──────────────────────────────────────────────────────────────────

/**
 * 규칙을 통째로 바꾼다. 모양이 틀린 규칙은 끈 채로 저장하고 사유를 남긴다.
 * 바로 삭제지만 감사 기록에 앞뒤가 남는다.
 */
export async function replaceRules(
  workspaceId: string, actorId: string | null, productId: string, version: number, rules: readonly PriceRule[],
): Promise<{ disabled: number }> {
  return withCrmTx(workspaceId, async (tx: Tx) => {
    const p = await tx.crmPriceProduct.findFirst({ where: { id: productId }, select: PRODUCT_SELECT })
    if (!p) throw new CrmError('NOT_FOUND', '제품을 찾을 수 없습니다.')
    const items = await tx.crmProduct.findMany({ where: { priceProductId: productId }, select: ITEM_SELECT })
    const engine = toEngineProduct(p, items, [])
    const problems = checkRules({ ...engine, rules: [...rules] })
    const reasonOf = new Map<number, string>()
    for (const pr of problems) if (!reasonOf.has(pr.index)) reasonOf.set(pr.index, pr.message)

    const res = await tx.crmPriceProduct.updateMany({ where: lockWhere(productId, version), data: BUMP_VERSION })
    assertUpdated(res.count, { exists: true, version: p.version }, '제품')
    const before = await tx.crmPriceRule.findMany({ where: { productId }, select: RULE_SELECT })
    await tx.crmPriceRule.deleteMany({ where: { productId } })
    for (let i = 0; i < rules.length; i++) {
      const row = ruleToRow(rules[i], i)
      const reason = reasonOf.get(i) ?? null
      await tx.crmPriceRule.create({
        data: { workspaceId, productId, ...row, isEnabled: reason === null, disabledReason: reason },
      })
    }
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'price_rule.replaced', targetType: 'price_product', targetId: productId, beforeJson: before, afterJson: rules })
    return { disabled: reasonOf.size }
  })
}

/** 계산 예시를 저장한다 — 미리 계산이 이 금액과 어긋나면 화면이 짚는다 */
export async function saveExamples(
  workspaceId: string, actorId: string | null, productId: string, version: number, examples: PriceProduct['examples'],
): Promise<void> {
  await withCrmTx(workspaceId, async (tx: Tx) => {
    const res = await tx.crmPriceProduct.updateMany({ where: lockWhere(productId, version), data: { examples: examplesToJson(examples ?? []), ...BUMP_VERSION } })
    assertUpdated(res.count, { exists: true, version }, '제품')
    await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'price_product.examples', targetType: 'price_product', targetId: productId })
  })
}
