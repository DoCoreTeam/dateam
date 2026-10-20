/**
 * 글로 채우기 한 바퀴 — 읽기 → (AI 얹기) → 조립 → 표 맞추기 → 고쳐 주기 (순수 함수)
 *
 * 서비스는 DB 에서 가격 기준을 읽고 AI 를 부르는 일만 하고, 판단은 전부 여기서 한다.
 * 그래서 같은 글이 시험에서도 운영에서도 같은 표를 낸다.
 *
 * 화면은 줄마다 `key` 를 붙여 보낸다(textKey 가 있으면 그것, 없으면 줄 id 나 자리).
 * 돌려주는 `ops` 와 `fixes` 는 그 키로 가리킨다.
 */

import { autofix, type Fix, type FixLine } from './autofix.ts'
import { composeFromText, type ComposeContext, type TextQuote, type TextLine } from './compose-from-text.ts'
import { mergeTextLines, type MergeResult } from './merge-text-lines.ts'
import { ruleReadRatio, type Reading } from './read-rules.ts'
import type { PriceProduct } from '../pricebook/types.ts'

/** 화면이 보내는 지금 표의 줄 */
export interface ClientLine extends FixLine {
  textKey: string | null
  discountPercent: string
}

export interface TextFillResult {
  quote: TextQuote
  ops: MergeResult['ops']
  differs: MergeResult['differs']
  fixes: Fix[]
  /** 규칙과 AI 둘 다 못 읽은 조각 */
  unread: { line: number; part: number; text: string }[]
  /** 규칙만으로 읽은 조각 비율 — AI 를 얹기 전에 잰다 */
  ruleRatio: number
}

function toFixLine(l: TextLine): FixLine {
  return {
    key: l.textKey, itemId: l.itemId, name: l.name, kind: l.kind, section: l.section,
    quantity: String(l.quantity), unit: l.unit,
    unitPriceMinor: l.unitPriceMinor === null ? '' : String(l.unitPriceMinor),
    listPriceMinor: l.listPriceMinor === null ? null : String(l.listPriceMinor),
    durationValue: l.durationValue === null ? '' : String(l.durationValue), durationUnit: l.durationUnit ?? '',
    ratioPct: l.ratioPct === null ? null : String(l.ratioPct), ratioOfSectionName: l.ratioOfSection,
    remark: l.remark ?? '', lockedFields: [],
  }
}

/** 맞춘 뒤의 표 — 지운 줄은 빠지고 고친 줄은 새 값, 새 줄은 뒤에. 잠근 칸은 옛 값 그대로 */
function afterMerge(current: readonly ClientLine[], merge: MergeResult): FixLine[] {
  const removed = new Set(merge.ops.flatMap((o) => (o.op === 'remove' ? [o.textKey] : [])))
  const updates = new Map(merge.ops.flatMap((o) => (o.op === 'update' ? [[o.textKey, o] as const] : [])))
  const kept: FixLine[] = current.filter((c) => !(c.textKey && removed.has(c.textKey))).map((c) => {
    const u = c.textKey ? updates.get(c.textKey) : undefined
    if (!u) return c
    const fresh = toFixLine(u.line)
    const locked = new Set(c.lockedFields)
    return {
      ...c,
      name: locked.has('name') ? c.name : fresh.name,
      quantity: locked.has('quantity') ? c.quantity : fresh.quantity,
      unit: locked.has('unit') ? c.unit : fresh.unit,
      unitPriceMinor: locked.has('unitPrice') ? c.unitPriceMinor : fresh.unitPriceMinor,
    }
  })
  const added = merge.ops.flatMap((o) => (o.op === 'add' ? [toFixLine(o.line)] : []))
  return [...kept, ...added]
}

export function runTextFill(
  ruleReadings: readonly Reading[],
  finalReadings: readonly Reading[],
  ctx: ComposeContext,
  current: readonly ClientLine[],
  products: readonly PriceProduct[],
): TextFillResult {
  const quote = composeFromText(finalReadings, ctx)
  const merge = mergeTextLines(current, quote.lines)
  const { fixes } = autofix(afterMerge(current, merge), products)
  return {
    quote,
    ops: merge.ops,
    differs: merge.differs,
    fixes,
    unread: finalReadings.filter((r) => r.unread).map((r) => ({ line: r.line, part: r.part, text: r.text })),
    ruleRatio: ruleReadRatio(ruleReadings),
  }
}
