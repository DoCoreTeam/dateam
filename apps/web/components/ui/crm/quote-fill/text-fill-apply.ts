/**
 * 글로 채우기의 응답 → 편집 초안 (순수 함수)
 *
 * 서버가 정한 것(ops, fixes)을 초안에 옮기기만 한다. 금액을 세지 않는다.
 * 줄은 키로 가리킨다 — 글에서 나온 줄은 `provenance.textKey`, 아니면 줄 id, 그것도 없으면 자리(`row3`).
 * 보낼 때와 받을 때 같은 키 함수(`lineKey`)를 쓴다.
 *
 * 사람이 고친 칸(`lockedFields`)은 서버도 안 고치지만 여기서도 한 번 더 지킨다.
 */

import type { QuoteDraft, QuoteLineDraft } from '../quote-draft-shape'
import type { QuoteLineKind } from '@/lib/terms/cost'

/** 서버가 주는 줄 — 금액은 문자열 정수 */
export interface TextLineJson {
  textKey: string
  fromLines: number[]
  section: string
  itemId: string | null
  name: string
  kind: string
  quantity: number
  unit: string
  unitPriceMinor: string | null
  listPriceMinor: string | null
  discountPercent: number
  taxRate: number
  billing: 'ONCE' | 'ANNUAL'
  ratioPct: number | null
  ratioOfSection: string | null
  durationValue: number | null
  durationUnit: string | null
  priceSource: string
  remark: string | null
  discountable: boolean
  provenance: Record<string, unknown>
}

export type TextOpJson =
  | { op: 'add'; line: TextLineJson }
  | { op: 'update'; textKey: string; line: TextLineJson; fields: string[] }
  | { op: 'remove'; textKey: string }

export interface FixJson {
  code: string
  key: string
  note: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  removed?: { line: Record<string, unknown>; index: number }
}

export interface Noted { field: string; value: string; provenance: { source: string; note?: string | null } }

export interface TextFillJson {
  quote: {
    sections: { name: string; roundingUnit: number }[]
    autoFilled: Noted[]
    autoFixed: Noted[]
    budgetMinor: string | null
    budgetIncludesTax: boolean
    conditions: Record<string, unknown> | null
  }
  ops: TextOpJson[]
  differs: { textKey: string; name: string; items: { field: string; locked: string; fromText: string }[] }[]
  fixes: FixJson[]
  unread: { line: number; part: number; text: string }[]
  ruleRatio: number
  aiStatus: 'NOT_NEEDED' | 'OFF' | 'CACHED' | 'OK' | 'QUOTA' | 'BUDGET' | 'FAILED'
  byAi: string[]
  aliases: { itemId: string; word: string }[]
  aiCache: { key: string; output: unknown } | null
}

export const textKeyOf = (l: QuoteLineDraft): string | null => {
  const k = (l.provenance as { textKey?: unknown } | null)?.textKey
  return typeof k === 'string' ? k : null
}

export const fromLinesOf = (l: QuoteLineDraft): number[] => {
  const v = (l.provenance as { fromLines?: unknown } | null)?.fromLines
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
}

export function lineKey(l: QuoteLineDraft, i: number): string {
  return textKeyOf(l) ?? l.id ?? `row${i}`
}

/** 서버로 보낼 지금 표 — 고쳐 주기와 맞추기가 쓰는 칸만 */
export function toClientLines(d: QuoteDraft): Record<string, unknown>[] {
  return d.lines.filter((l) => l.name.trim() !== '').map((l) => ({
    key: lineKey(l, d.lines.indexOf(l)),
    textKey: textKeyOf(l),
    itemId: l.productId ?? null,
    name: l.name,
    kind: l.kind,
    section: typeof l.sectionIndex === 'number' ? (d.sections[l.sectionIndex]?.name ?? null) : null,
    quantity: l.quantity,
    unit: l.unit,
    unitPriceMinor: l.unitPriceMinor,
    listPriceMinor: l.listPriceMinor ?? null,
    durationValue: l.durationValue ?? '',
    durationUnit: l.durationUnit ?? '',
    ratioPct: l.ratioPct ?? null,
    ratioOfSectionName: l.ratioOfSectionName ?? null,
    remark: l.remark,
    discountPercent: l.discountPercent,
    lockedFields: l.lockedFields ?? [],
  }))
}

function sectionIndexOf(sections: QuoteDraft['sections'], name: string): { sections: QuoteDraft['sections']; index: number } {
  const at = sections.findIndex((s) => s.name === name)
  if (at >= 0) return { sections, index: at }
  return { sections: [...sections, { name, roundingUnit: 0, businessTypeKey: null }], index: sections.length }
}

function fromText(l: TextLineJson, sectionIndex: number): QuoteLineDraft {
  const isRatio = l.ratioPct !== null
  return {
    productId: l.itemId,
    name: l.name,
    descriptionMd: '',
    remark: l.remark ?? '',
    kind: l.kind as QuoteLineKind,
    quantity: String(l.quantity),
    unit: l.unit,
    durationValue: l.durationValue === null ? '' : String(l.durationValue),
    durationUnit: l.durationUnit ?? '',
    unitPriceMinor: l.unitPriceMinor ?? '',
    discountPercent: String(l.discountPercent),
    specialDiscountPercent: '',
    taxRate: String(l.taxRate),
    sectionIndex,
    listPriceMinor: l.listPriceMinor,
    priceSource: l.priceSource,
    provenance: { ...l.provenance, textKey: l.textKey, fromLines: l.fromLines, discountable: l.discountable },
    billing: l.billing,
    ratioPct: isRatio ? String(l.ratioPct) : null,
    ratioOfSectionName: isRatio ? l.ratioOfSection : null,
    lockedFields: [],
  }
}

/** 잠긴 칸은 옛 값 그대로 두고 나머지를 새 값으로 */
function updated(cur: QuoteLineDraft, l: TextLineJson, sectionIndex: number): QuoteLineDraft {
  const fresh = fromText(l, sectionIndex)
  const locked = new Set(cur.lockedFields ?? [])
  return {
    ...fresh,
    id: cur.id,
    descriptionMd: cur.descriptionMd,
    name: locked.has('name') ? cur.name : fresh.name,
    quantity: locked.has('quantity') ? cur.quantity : fresh.quantity,
    unitPriceMinor: locked.has('unitPrice') ? cur.unitPriceMinor : fresh.unitPriceMinor,
    discountPercent: locked.has('discount') ? cur.discountPercent : fresh.discountPercent,
    lockedFields: cur.lockedFields ?? [],
    provenance: locked.has('unitPrice') ? { ...fresh.provenance, unitPrice: (cur.provenance as Record<string, unknown> | null)?.unitPrice ?? null } : fresh.provenance,
  }
}

/** 고쳐 주기의 칸 이름(서버) → 초안 칸 이름 */
function fixPatch(after: Record<string, unknown>): Partial<QuoteLineDraft> {
  const out: Partial<QuoteLineDraft> = {}
  for (const [k, v] of Object.entries(after)) {
    if (k === 'itemId') out.productId = (v as string | null) ?? null
    else if (k === 'section') continue
    else (out as Record<string, unknown>)[k] = v
  }
  return out
}

export interface Applied {
  draft: QuoteDraft
  /** 이번에 바뀐 줄 수 — 화면이 「표를 고쳤어요」를 말할지 정한다 */
  changed: number
}

export function applyTextFill(draft: QuoteDraft, res: TextFillJson, text: string): Applied {
  let sections = draft.sections
  const keyed = draft.lines.map((l, i) => ({ key: lineKey(l, i), line: l }))
  const removes = new Set(res.ops.flatMap((o) => (o.op === 'remove' ? [o.textKey] : [])))
  const updates = new Map(res.ops.flatMap((o) => (o.op === 'update' ? [[o.textKey, o.line] as const] : [])))
  let rows = keyed.filter((r) => !(textKeyOf(r.line) && removes.has(textKeyOf(r.line) as string))).map((r) => {
    const u = updates.get(r.key)
    if (!u) return r
    const s = sectionIndexOf(sections, u.section)
    sections = s.sections
    return { key: r.key, line: updated(r.line, u, s.index) }
  })
  for (const o of res.ops) {
    if (o.op !== 'add') continue
    const s = sectionIndexOf(sections, o.line.section)
    sections = s.sections
    rows.push({ key: o.line.textKey, line: fromText(o.line, s.index) })
  }
  for (const f of res.fixes) {
    if (f.removed) { rows = rows.filter((r) => r.key !== String(f.removed?.line.key ?? '')); }
    rows = rows.map((r) => (r.key === f.key ? { ...r, line: { ...r.line, ...fixPatch(f.after) } } : r))
  }
  // 빈 견적의 빈 줄 하나는 지운다 — 글에서 나온 줄 앞에 이름 없는 줄이 남지 않게
  if (rows.length > 1) rows = rows.filter((r) => r.line.name.trim() !== '' || r.line.id)
  // 서버가 정한 절사 단위를 묶음에 싣는다(라이선스 만원 미만 절사)
  sections = sections.map((s) => {
    const q = res.quote.sections.find((x) => x.name === s.name)
    return q && !s.id && !s.roundingUnit ? { ...s, roundingUnit: q.roundingUnit } : s
  })
  const textNotes = [...res.quote.autoFilled, ...res.quote.autoFixed]
  const aliases = mergeAliases(draft.learnedAliases ?? [], res.aliases)
  const changed = res.ops.length + res.fixes.length
  return {
    changed,
    draft: {
      ...draft,
      sections,
      lines: rows.map((r) => r.line),
      fillText: text,
      autoFilled: textNotes.length > 0 || changed > 0 ? textNotes : draft.autoFilled,
      fillConditions: res.quote.conditions ?? draft.fillConditions ?? null,
      budgetMinor: res.quote.budgetMinor ?? draft.budgetMinor ?? null,
      budgetIncludesTax: res.quote.budgetMinor ? res.quote.budgetIncludesTax : draft.budgetIncludesTax,
      learnedAliases: aliases,
    },
  }
}

function mergeAliases(a: readonly { itemId: string; word: string }[], b: readonly { itemId: string; word: string }[]) {
  const seen = new Set(a.map((x) => `${x.itemId}|${x.word}`))
  return [...a, ...b.filter((x) => !seen.has(`${x.itemId}|${x.word}`))]
}
