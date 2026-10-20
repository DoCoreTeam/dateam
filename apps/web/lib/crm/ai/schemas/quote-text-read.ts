/**
 * 견적 글 읽기 — AI 가 내는 모양과 그 결과를 규칙 조각에 얹는 일
 *
 * **AI 는 금액을 내지 않는다.** 이 스키마에는 금액 칸이 없다. 규칙이 못 읽은 조각이
 * 어느 제품의 어느 조건인지(품목, 에디션, GPU 몇 장, 공수와 등급, 기간)만 고른다.
 * 금액은 엔진이 센다 — 금액을 정하는 자리가 둘이면 둘이 갈라진다(34,980,000 → 17,503,200 사고).
 *
 * 받은 목록 밖의 id 는 버린다. AI 가 지어낸 품목은 표에 들어오지 않는다.
 */

import { z } from 'zod'
import { canonicalizeModel } from '../../../gpu/canonical-model.ts'
import { LINE_KIND_ORDER, type QuoteLineKind } from '../../../terms/cost.ts'
import { LABOR_GRADE_NAMES, type LaborGradeName } from '../../domain/pricebook/basis-lines.ts'
import type { Catalog, Reading } from '../../domain/quote-text/read-rules.ts'

/** 조각의 구실 — 무엇으로 표에 들어가나. NOTE 는 표에 안 들어가는 말(「담당자가 꼼꼼함」) */
export const READ_ROLES = ['PRODUCT', 'ITEM', 'LABOR', 'GPU_USAGE', 'NOTE'] as const
export type ReadRole = typeof READ_ROLES[number]

/** AI 에게 보내는 것 — 못 읽은 조각과 품목 이름 목록뿐. 원가도 정상가도 싣지 않는다 */
export interface TextReadInput {
  clauses: { ref: string; text: string }[]
  products: { id: string; name: string; items: { id: string; name: string }[] }[]
  items: { id: string; name: string }[]
  grades: readonly string[]
  kinds: readonly QuoteLineKind[]
}

const nullableText = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 120) : null), z.string().nullable())
const nullableCount = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null
}, z.number().nullable())

export const TextReadItemSchema = z.object({
  ref: z.string().min(1).max(20),
  role: z.enum(READ_ROLES),
  productId: nullableText.optional().default(null),
  itemId: nullableText.optional().default(null),
  edition: z.enum(['STD', 'ENT']).nullable().optional().default(null),
  gpuModel: nullableText.optional().default(null),
  count: nullableCount.optional().default(null),
  months: nullableCount.optional().default(null),
  hours: nullableCount.optional().default(null),
  grade: nullableText.optional().default(null),
  manMonths: nullableCount.optional().default(null),
  /** 줄 이름 — 「SSO 정산 연동」 */
  name: nullableText.optional().default(null),
  kind: z.enum(LINE_KIND_ORDER as [QuoteLineKind, ...QuoteLineKind[]]).nullable().optional().default(null),
  /** 품목을 가리킨 글의 낱말 — 「에이치백」. 사람이 받아들이면 별칭이 된다 */
  alias: nullableText.optional().default(null),
}).strict()

export const TextReadOutputSchema = z.object({ readings: z.array(TextReadItemSchema).max(120) })
export type TextReadItem = z.infer<typeof TextReadItemSchema>
export type TextReadOutput = z.infer<typeof TextReadOutputSchema>

export function parseTextRead(text: string): TextReadOutput {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return TextReadOutputSchema.parse(JSON.parse(trimmed))
}

export const refOf = (r: Pick<Reading, 'line' | 'part'>) => `${r.line}.${r.part}`

/** 못 읽은 조각만 골라 AI 입력을 만든다. 정상가와 원가는 처음부터 이 모양에 칸이 없다 */
export function buildTextReadInput(readings: readonly Reading[], catalog: Catalog): TextReadInput {
  return {
    clauses: readings.filter((r) => r.unread).map((r) => ({ ref: refOf(r), text: r.text })),
    products: catalog.products.map((p) => ({ id: p.id, name: p.name, items: p.items.map((i) => ({ id: i.id, name: i.name })) })),
    items: catalog.items.map((i) => ({ id: i.id, name: i.name })),
    grades: LABOR_GRADE_NAMES,
    kinds: LINE_KIND_ORDER,
  }
}

export interface AliasCandidate {
  itemId: string
  word: string
}

/**
 * AI 의 읽기를 규칙 조각에 얹는다. 목록 밖 id, 모르는 등급은 버린다.
 * AI 가 읽은 조각은 `byAi` 로 남긴다 — 화면이 「AI 가 읽음」을 표시하고, 저장하면 별칭이 된다.
 */
export function applyAiReadings(readings: readonly Reading[], out: TextReadOutput, catalog: Catalog): { readings: Reading[]; aliases: AliasCandidate[]; byAi: string[] } {
  const productIds = new Set(catalog.products.map((p) => p.id))
  const itemIds = new Set([...catalog.items, ...catalog.products.flatMap((p) => p.items)].map((i) => i.id))
  const byRef = new Map(out.readings.map((x) => [x.ref, x]))
  const aliases: AliasCandidate[] = []
  const byAi: string[] = []
  const next = readings.map((r) => {
    const a = r.unread ? byRef.get(refOf(r)) : undefined
    if (!a || a.role === 'NOTE') return r
    const productId = a.productId && productIds.has(a.productId) ? a.productId : null
    const itemId = a.itemId && itemIds.has(a.itemId) ? a.itemId : null
    const grade = a.grade && (LABOR_GRADE_NAMES as readonly string[]).includes(a.grade) ? (a.grade as LaborGradeName) : null
    const gpus = a.gpuModel ? [{ model: canonicalizeModel(a.gpuModel).canonical, count: a.count }] : []
    const merged: Reading = {
      ...r,
      productId: r.productId ?? (a.role === 'PRODUCT' ? productId : null),
      itemIds: itemId ? [...new Set([...r.itemIds, itemId])] : r.itemIds,
      edition: r.edition ?? a.edition,
      gpus: r.gpus.length > 0 ? r.gpus : gpus,
      months: r.months ?? (a.role === 'GPU_USAGE' || a.role === 'LABOR' ? a.months : null),
      hours: r.hours ?? (a.role === 'GPU_USAGE' ? a.hours : null),
      grade: r.grade ?? grade,
      manMonths: r.manMonths ?? (a.role === 'LABOR' ? a.manMonths : null),
      counts: r.counts.length > 0 || a.role !== 'ITEM' || a.count === null ? r.counts : [{ value: a.count, unit: '개' }],
      rest: a.name ?? r.rest,
      unread: false,
    }
    const changed = merged.productId !== r.productId || merged.itemIds.length !== r.itemIds.length || merged.gpus.length !== r.gpus.length
      || merged.grade !== r.grade || merged.manMonths !== r.manMonths || merged.counts.length !== r.counts.length || merged.edition !== r.edition
    if (!changed) return r
    byAi.push(refOf(r))
    if (itemId && a.alias) aliases.push({ itemId, word: a.alias })
    return merged
  })
  return { readings: next, aliases, byAi }
}
