/**
 * 가격 기준 파일로 가져오기 (서비스) — 읽기와 저장 두 걸음
 *
 * 읽기: 파일 → 글(또는 그림) → AI 가 적힌 그대로 옮김 → 규칙이 단위를 곱하고 검증 2~6 → 초안.
 *       **DB 에 아무것도 쓰지 않는다.** 화면이 원본과 나란히 보여 준다(검증 7).
 * 저장: 초안을 한 트랜잭션으로. 실패하면 하나도 안 남는다. 다시 올리면 새로 만들지 않고 바뀐 것만 고치고,
 *       새 파일에 없는 품목은 지우지 않고 판매 중지로 둔다. 가격 이력에는 그 파일 이름이 남는다.
 *
 * 저장 때 검증을 다시 돈다. 초안은 화면을 한 번 거쳐 돌아오므로 그 사이 바뀌었을 수 있다.
 */

import { getCrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { BUMP_VERSION } from '../db/optimistic.ts'
import { CrmError } from '../domain/errors.ts'
import { runAi, type AiAdapter } from '../ai/runner.ts'
import { pricebookReadPrompt } from '../ai/prompts/pricebook-read.v1.ts'
import { parsePricebookRead } from '../ai/schemas/pricebook-read.ts'
import { buildImportDraft, type ImportDraft, type ImportTarget, type PriceSheetRead } from '../domain/pricebook/import-draft.ts'
import { checkExamples, checkRules, amountInSource, sourceUnitOf } from '../domain/pricebook/validate.ts'
import { adapterFromSetting } from './quick-create.ts'
import { readFileForAi, type QuoteFromFileInput } from './quote-from-file.ts'
import { writeItemTx, ITEM_SELECT } from './pricebook.ts'
import { examplesToJson } from './pricebook-map.ts'
import { createLaborGradeTx, updateLaborGradeTx } from './labor-grade.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

/** 원문은 이만큼까지만 AI 에 보내고 화면에 돌려준다 — 가격표 한 벌이면 넉넉하다 */
const MAX_SOURCE_CHARS = 30_000

export interface ReadPriceSheetInput extends QuoteFromFileInput {
  target: ImportTarget
  /** 이 제품에 다시 올리는 것이면 그 id — 차이 보기(6)의 기준 */
  productId?: string | null
}

export interface ReadPriceSheetResult {
  draft: ImportDraft
  /** 원문 글 — 나란히 보기(7)와 저장 때 원문 대조(2)를 다시 도는 데 쓴다. 그림째 읽었으면 빈 글 */
  sourceText: string
  fileName: string
  route: 'text' | 'vision'
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

export async function readPriceSheet(
  workspaceId: string, actorId: string | null, input: ReadPriceSheetInput, adapter?: AiAdapter,
): Promise<ReadPriceSheetResult> {
  const { kind, read, attachments } = await readFileForAi(input, { maxChars: MAX_SOURCE_CHARS })
  const route = attachments ? 'vision' : 'text'
  const db = getCrmDb(workspaceId)
  const chosen = adapter ?? await adapterFromSetting(db, { attachments, actorId })
  const { output } = await runAi<PriceSheetRead>({
    actorId, db, workspaceId, kind: 'QUICK_CREATE',
    prompt: pricebookReadPrompt(input.target),
    input: route === 'vision' ? '이 파일이 가격표다. 표와 비고를 그대로 옮겨라.' : read.text,
    inputRef: { fileName: input.fileName, kind, route, chars: read.text.length, target: input.target },
    parse: parsePricebookRead,
    adapter: chosen,
  })
  const existing = await existingFor(db, input.target, input.productId ?? null, output.product?.name ?? null)
  const draft = buildImportDraft(input.target, output, route === 'text' ? read.text : '', existing)
  return { draft, sourceText: route === 'text' ? read.text : '', fileName: input.fileName, route }
}

async function existingFor(db: ReturnType<typeof getCrmDb>, target: ImportTarget, productId: string | null, name: string | null) {
  if (target !== 'product') return []
  const p = productId
    ? await (db as Tx).crmPriceProduct.findFirst({ where: { id: productId }, select: { id: true } })
    : name ? await (db as Tx).crmPriceProduct.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } }) : null
  if (!p) return []
  const items = await (db as Tx).crmProduct.findMany({ where: { priceProductId: p.id, isActive: true }, select: { id: true, name: true, unitPriceMinor: true } })
  return items.map((i: { id: string; name: string; unitPriceMinor: bigint }) => ({ id: i.id, name: i.name, listPriceMinor: BigInt(i.unitPriceMinor) }))
}

/** 화면을 거쳐 돌아온 초안 — 금액 문자열을 bigint 로 되돌리고 검증 2 3 4 5 를 다시 돈다 */
export function revalidateDraft(raw: unknown, sourceText: string): ImportDraft {
  if (typeof raw !== 'object' || raw === null) throw new CrmError('VALIDATION_FAILED', '가져올 내용이 없어요.')
  const d = raw as ImportDraft
  const big = (v: unknown): bigint | null => (v === null || v === undefined || v === '' ? null : BigInt(String(v)))
  const docUnit = sourceUnitOf(sourceText)
  const items = (d.items ?? []).slice(0, 200).map((it) => {
    const listPriceMinor = big(it.listPriceMinor)
    if (listPriceMinor !== null && listPriceMinor < BigInt(0)) {
      throw new CrmError('VALIDATION_FAILED', `${it.name} 정상가가 음수예요. 파일을 확인해 주세요.`)
    }
    if (it.ratioPct !== null && it.ratioPct !== undefined && !(Number(it.ratioPct) >= 0 && Number(it.ratioPct) <= 100)) {
      throw new CrmError('VALIDATION_FAILED', `${it.name} 비율은 0에서 100 사이여야 해요.`)
    }
    const problems = [...(it.problems ?? []).filter((p) => p !== '이 숫자를 원문에서 못 찾았어요')]
    if (sourceText && listPriceMinor !== null && listPriceMinor > BigInt(0) && !amountInSource(listPriceMinor, sourceText, docUnit)) {
      problems.push('이 숫자를 원문에서 못 찾았어요')
    }
    return { ...it, listPriceMinor, problems, needsReview: problems.length > 0 }
  })
  const rules = (d.rules ?? []).map((r) => r.rule)
  const product = { id: 'draft', name: d.product?.name ?? '', businessTypeKey: d.product?.businessTypeKey ?? 'SOLUTION', sections: d.sections ?? [], items, rules, tcoYears: 5, freeYears: 1 }
  const reasonOf = new Map<number, string>()
  for (const p of checkRules(product)) if (!reasonOf.has(p.index)) reasonOf.set(p.index, p.message)
  const examples = (d.examples ?? []).map((e) => ({ ...e, expectOnceMinor: BigInt(String(e.expectOnceMinor)), expectAnnualMinor: BigInt(String(e.expectAnnualMinor)), expectTcoMinor: big(e.expectTcoMinor) }))
  const live = rules.filter((_, i) => !reasonOf.has(i))
  const exampleChecks = d.target === 'product' ? checkExamples({ ...product, rules: live, examples }) : []
  const grades = (d.grades ?? []).map((g) => ({ ...g, publicRateMinor: big(g.publicRateMinor), pricePerMmMinor: big(g.pricePerMmMinor) }))
  return {
    ...d,
    items,
    rules: rules.map((rule, i) => ({ rule, disabledReason: reasonOf.get(i) ?? null })),
    examples,
    exampleChecks,
    grades,
    productNeedsReview: d.productNeedsReview || exampleChecks.some((c) => !c.ok) || items.some((i) => i.problems.includes('단위를 곱하지 않은 것 같아요')),
  }
}

export interface SavePriceImportInput {
  draft: unknown
  sourceText: string
  fileName: string
  productId?: string | null
}

export interface SavePriceImportResult {
  productId: string | null
  created: number
  updated: number
  stopped: number
  needsReview: number
  rulesOff: number
  grades: number
}

export async function savePriceImport(
  workspaceId: string, actorId: string | null, input: SavePriceImportInput,
): Promise<SavePriceImportResult> {
  const draft = revalidateDraft(input.draft, input.sourceText ?? '')
  const fileName = String(input.fileName ?? '').slice(0, 200) || '가격표'
  return withCrmTx(workspaceId, async (tx: Tx) => {
    if (draft.target === 'labor') return saveGrades(tx, workspaceId, actorId, draft, fileName)
    if (draft.target === 'items') return saveLooseItems(tx, workspaceId, actorId, draft, fileName, input.productId ?? null)
    return saveProduct(tx, workspaceId, actorId, draft, fileName, input.productId ?? null)
  })
}

async function saveProduct(
  tx: Tx, workspaceId: string, actorId: string | null, draft: ImportDraft, fileName: string, productId: string | null,
): Promise<SavePriceImportResult> {
  const name = draft.product?.name ?? '이름 없는 제품'
  let product = productId
    ? await tx.crmPriceProduct.findFirst({ where: { id: productId }, select: { id: true } })
    : await tx.crmPriceProduct.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })
  if (!product) {
    product = await tx.crmPriceProduct.create({
      data: { workspaceId, name, businessTypeKey: draft.product?.businessTypeKey ?? 'SOLUTION', createdById: actorId },
      select: { id: true },
    })
  }
  const pid = product.id as string
  const existing = await tx.crmProduct.findMany({ where: { priceProductId: pid }, select: ITEM_SELECT })
  const byName = new Map(existing.map((e: { id: string; name: string }) => [norm(e.name), e]))
  const idMap = new Map<string, string>()
  let created = 0, updated = 0
  for (let i = 0; i < draft.items.length; i++) {
    const it = draft.items[i]
    const match = byName.get(norm(it.name)) as { id: string } | undefined
    const realId = await writeItemTx(tx, workspaceId, actorId, pid, { ...it, id: match?.id, needsReview: it.needsReview }, i, { sourceKind: 'FILE', sourceName: fileName })
    if (match) {
      updated++
      await tx.crmProduct.update({ where: { id: realId }, data: { isActive: true } })
    } else created++
    idMap.set(it.id, realId)
  }
  // 새 파일에 없는 품목 — 지우지 않고 판매 중지. 지난 견적이 가리킨다
  const kept = new Set(idMap.values())
  const gone = existing.filter((e: { id: string; isActive: boolean }) => e.isActive && !kept.has(e.id))
  for (const g of gone) await tx.crmProduct.update({ where: { id: g.id }, data: { isActive: false, ...BUMP_VERSION } })

  const remap = (v: unknown): unknown => (typeof v === 'string' ? idMap.get(v) ?? v : Array.isArray(v) ? v.map(remap) : v)
  await tx.crmPriceRule.deleteMany({ where: { productId: pid } })
  let rulesOff = 0
  for (let i = 0; i < draft.rules.length; i++) {
    const { rule, disabledReason } = draft.rules[i]
    const { kind, ...body } = rule
    const mapped = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, k === 'item' || k === 'items' || k === 'with' ? remap(v) : v]))
    if (disabledReason) rulesOff++
    await tx.crmPriceRule.create({ data: { workspaceId, productId: pid, kind, body: mapped, position: i, isEnabled: !disabledReason, disabledReason } })
  }
  const examples = draft.examples.map((e) => ({ ...e, conditions: { ...e.conditions, picked: e.conditions.picked.map((p) => idMap.get(p) ?? p) } }))
  await tx.crmPriceProduct.update({
    where: { id: pid },
    data: {
      ...(draft.sections.length ? { sections: draft.sections } : {}),
      examples: examplesToJson(examples),
      needsReview: draft.productNeedsReview,
      sourceFileName: fileName,
      ...BUMP_VERSION,
    },
  })
  await writeAudit(tx, {
    actorType: 'HUMAN', actorId, action: 'price_product.imported', targetType: 'price_product', targetId: pid,
    afterJson: { fileName, created, updated, stopped: gone.length, rulesOff },
  })
  return { productId: pid, created, updated, stopped: gone.length, needsReview: draft.items.filter((i) => i.needsReview).length, rulesOff, grades: 0 }
}

async function saveLooseItems(
  tx: Tx, workspaceId: string, actorId: string | null, draft: ImportDraft, fileName: string, productId: string | null,
): Promise<SavePriceImportResult> {
  const existing = await tx.crmProduct.findMany({ where: { priceProductId: productId, isActive: true }, select: ITEM_SELECT })
  const byName = new Map(existing.map((e: { id: string; name: string }) => [norm(e.name), e]))
  let created = 0, updated = 0
  for (let i = 0; i < draft.items.length; i++) {
    const it = draft.items[i]
    const match = byName.get(norm(it.name)) as { id: string; position: number } | undefined
    await writeItemTx(tx, workspaceId, actorId, productId, { ...it, id: match?.id }, match?.position ?? existing.length + i, { sourceKind: 'FILE', sourceName: fileName })
    if (match) updated++; else created++
  }
  await writeAudit(tx, { actorType: 'HUMAN', actorId, action: 'product.imported', targetType: 'product', targetId: productId ?? 'loose', afterJson: { fileName, created, updated } })
  return { productId, created, updated, stopped: 0, needsReview: draft.items.filter((i) => i.needsReview).length, rulesOff: 0, grades: 0 }
}

async function saveGrades(tx: Tx, workspaceId: string, actorId: string | null, draft: ImportDraft, fileName: string): Promise<SavePriceImportResult> {
  const existing = await tx.crmLaborGrade.findMany({ where: {}, select: { id: true, name: true } })
  const byName = new Map(existing.map((g: { id: string; name: string }) => [norm(g.name), g.id]))
  let created = 0, updated = 0
  for (let i = 0; i < draft.grades.length; i++) {
    const g = draft.grades[i]
    const input = {
      name: g.name,
      ...(g.publicRateMinor !== null ? { publicRateMinor: g.publicRateMinor.toString() } : {}),
      ...(g.pricePerMmMinor !== null ? { pricePerMmMinor: g.pricePerMmMinor.toString() } : {}),
      ...(g.effectiveFrom ? { effectiveFrom: g.effectiveFrom } : {}),
    }
    const id = byName.get(norm(g.name)) as string | undefined
    if (id) { await updateLaborGradeTx(tx, workspaceId, actorId, id, null, input, 'FILE', fileName); updated++ }
    else { await createLaborGradeTx(tx, workspaceId, actorId, { ...input, position: existing.length + i }, 'FILE', fileName); created++ }
  }
  return { productId: null, created, updated, stopped: 0, needsReview: draft.grades.filter((g) => g.problems.length > 0).length, rulesOff: 0, grades: draft.grades.length }
}
