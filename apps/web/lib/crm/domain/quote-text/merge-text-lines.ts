/**
 * 다시 정리 — 글에서 나온 새 줄과 지금 표를 맞춘다 (순수 함수)
 *
 * 표를 통째로 다시 쓰지 않는다. AI 를 다시 부를 때마다 표가 흔들리면 사람이 못 쓴다.
 *   - 같은 `textKey` 줄은 바뀐 칸만 고친다. 바뀐 것이 없으면 아무 일도 없다
 *   - 사람이 고친 칸(`lockedFields`)은 안 덮는다. 새 값과 다르면 「조건과 다름」 한 줄을 남긴다
 *   - 글에서 사라진 키의 줄만 지운다. 글에서 안 나온 줄(사람이 표에 직접 쓴 줄)은 손대지 않는다
 *   - 새 키는 더한다
 */

import type { TextLine } from './compose-from-text.ts'

/** 지금 표의 줄 — 비교에 쓰는 칸만. 금액은 문자열 정수 */
export interface CurrentLine {
  textKey: string | null
  lockedFields: readonly string[]
  name: string
  quantity: string
  unit: string
  unitPriceMinor: string
  discountPercent: string
}

/** 잠글 수 있는 칸 이름 — 편집 화면의 `lockIfHuman` 이 쓰는 이름과 같다 */
export type LockField = 'name' | 'quantity' | 'unit' | 'unitPrice' | 'discount'

export interface Differs {
  field: LockField
  /** 사람이 고친 값 */
  locked: string
  /** 글과 기준이 낸 값 */
  fromText: string
}

export type TextOp =
  | { op: 'add'; line: TextLine }
  | { op: 'update'; textKey: string; line: TextLine; fields: LockField[] }
  | { op: 'remove'; textKey: string }

export interface MergeResult {
  ops: TextOp[]
  /** 잠근 칸이 글과 다른 것 — 화면이 「조건과 다름」으로 말한다 */
  differs: { textKey: string; name: string; items: Differs[] }[]
}

function textValue(l: TextLine, f: LockField): string {
  switch (f) {
    case 'name': return l.name
    case 'quantity': return String(l.quantity)
    case 'unit': return l.unit
    case 'unitPrice': return l.unitPriceMinor === null ? '' : String(l.unitPriceMinor)
    case 'discount': return String(l.discountPercent)
  }
}

function currentValue(c: CurrentLine, f: LockField): string {
  switch (f) {
    case 'name': return c.name
    case 'quantity': return c.quantity
    case 'unit': return c.unit
    case 'unitPrice': return c.unitPriceMinor
    case 'discount': return c.discountPercent
  }
}

const FIELDS: readonly LockField[] = ['name', 'quantity', 'unit', 'unitPrice', 'discount']

/** 숫자 칸은 「4」와 「4.0」을 같게 본다 */
function same(a: string, b: string): boolean {
  if (a === b) return true
  const na = Number(a), nb = Number(b)
  return a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

export function mergeTextLines(current: readonly CurrentLine[], next: readonly TextLine[]): MergeResult {
  const ops: TextOp[] = []
  const differs: MergeResult['differs'] = []
  const nextKeys = new Set(next.map((l) => l.textKey))
  const byKey = new Map(current.filter((c) => c.textKey).map((c) => [c.textKey as string, c]))

  for (const c of current) {
    if (c.textKey && !nextKeys.has(c.textKey)) ops.push({ op: 'remove', textKey: c.textKey })
  }
  for (const l of next) {
    const c = byKey.get(l.textKey)
    if (!c) { ops.push({ op: 'add', line: l }); continue }
    const locked = new Set(c.lockedFields)
    const changed = FIELDS.filter((f) => !locked.has(f) && !same(currentValue(c, f), textValue(l, f)))
    const conflict = FIELDS.filter((f) => locked.has(f) && !same(currentValue(c, f), textValue(l, f)))
      .map((f) => ({ field: f, locked: currentValue(c, f), fromText: textValue(l, f) }))
    if (changed.length > 0) ops.push({ op: 'update', textKey: l.textKey, line: l, fields: changed })
    if (conflict.length > 0) differs.push({ textKey: l.textKey, name: c.name, items: conflict })
  }
  return { ops, differs }
}
