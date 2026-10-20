/**
 * 고쳐 주기 — 규칙이 확실히 아는 실수는 안내만 띄우지 않고 고쳐 둔다 (순수 함수)
 *
 * 고친 것마다 이전 칸 값을 함께 남긴다. 화면은 그것으로 「자동으로 고친 값」 목록과
 * 줄마다 되돌리기를 그린다. 사람이 고친 칸(`lockedFields`)은 고치지 않는다.
 *
 * 일곱 가지. 늘 같은 답을 내고 AI 를 부르지 않는다.
 *   PERIOD_IN_QTY   「1,440 Hours」가 수량 칸에 들어감 → 기간 칸으로
 *   HUNDRED_X       통화 자리수가 틀려 정상가의 100배(또는 100분의 1)
 *   DUPLICATE       같은 품목이 같은 묶음에 두 줄
 *   INCLUDED_PAID   기본 포함 품목(ENT 의 옵션)을 따로 받음
 *   CAP_EXCEEDED    에디션 상한(STD GPU 300장)을 넘음 → 상한에 맞는 에디션으로
 *   RATIO_ORPHAN    비율 항목의 대상 묶음이 사라짐
 *   TEN_X_OFF       정상가와 10배 넘게 다름
 */

import type { PriceProduct, PriceRule } from '../pricebook/types.ts'

export interface FixLine {
  key: string
  itemId: string | null
  name: string
  kind: string
  section: string | null
  quantity: string
  unit: string
  unitPriceMinor: string
  listPriceMinor: string | null
  durationValue: string
  durationUnit: string
  ratioPct: string | null
  ratioOfSectionName: string | null
  remark: string
  lockedFields: readonly string[]
}

export type FixCode =
  | 'PERIOD_IN_QTY' | 'HUNDRED_X' | 'DUPLICATE' | 'INCLUDED_PAID' | 'CAP_EXCEEDED' | 'RATIO_ORPHAN' | 'TEN_X_OFF'

export interface Fix {
  code: FixCode
  key: string
  /** 사람이 읽을 한 줄 */
  note: string
  /** 고치기 전 칸 — 되돌리기가 이 값을 다시 넣는다. 지운 줄이면 줄 통째 */
  before: Partial<FixLine>
  after: Partial<FixLine>
  /** 줄을 지웠으면 그 줄과 자리 */
  removed?: { line: FixLine; index: number }
}

export interface AutofixResult {
  lines: FixLine[]
  fixes: Fix[]
}

const HOUR_UNIT = /^(hours?|hrs?|h|시간)$/i
const won = (v: string | bigint) => Number(v).toLocaleString('ko-KR')
const n = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === '' ? null : Number(v))
const locked = (l: FixLine, f: string) => l.lockedFields.includes(f)

function patch(lines: FixLine[], i: number, after: Partial<FixLine>, code: FixCode, note: string, fixes: Fix[]): void {
  const cur = lines[i]
  const before = Object.fromEntries(Object.keys(after).map((k) => [k, cur[k as keyof FixLine]])) as Partial<FixLine>
  lines[i] = { ...cur, ...after }
  fixes.push({ code, key: cur.key, note, before, after })
}

function periodInQuantity(lines: FixLine[], fixes: Fix[]): void {
  lines.forEach((l, i) => {
    if (!HOUR_UNIT.test(l.unit.trim()) || l.durationValue.trim() !== '' || locked(l, 'quantity')) return
    const hours = n(l.quantity)
    if (hours === null || hours <= 1) return
    patch(lines, i, { kind: 'PERIOD', quantity: '1', unit: '대', durationValue: String(hours), durationUnit: 'HOUR' }, 'PERIOD_IN_QTY',
      `「${won(String(hours))} ${l.unit}」은 대수가 아니라 기간이라 기간 칸으로 옮김 (1대 × ${won(String(hours))}시간)`, fixes)
  })
}

function priceScale(lines: FixLine[], fixes: Fix[]): void {
  lines.forEach((l, i) => {
    const price = n(l.unitPriceMinor), list = n(l.listPriceMinor)
    if (price === null || list === null || list <= 0 || price <= 0 || locked(l, 'unitPrice')) return
    if (price === list * 100 || price * 100 === list) {
      patch(lines, i, { unitPriceMinor: String(list) }, 'HUNDRED_X',
        `단가 ${won(String(price))}원이 정상가 ${won(String(list))}원의 ${price > list ? '100배' : '100분의 1'}라 통화 자리수 실수로 보고 정상가로 고침`, fixes)
      return
    }
    const ratio = price > list ? price / list : list / price
    if (ratio > 10) {
      patch(lines, i, { unitPriceMinor: String(list) }, 'TEN_X_OFF',
        `단가 ${won(String(price))}원이 정상가 ${won(String(list))}원과 10배 넘게 달라 정상가로 고침`, fixes)
    }
  })
}

function duplicates(lines: FixLine[], fixes: Fix[]): void {
  for (let i = 0; i < lines.length; i += 1) {
    const a = lines[i]
    const sameKey = (b: FixLine) => (a.itemId !== null ? b.itemId === a.itemId : b.name.trim() === a.name.trim() && b.unitPriceMinor === a.unitPriceMinor)
    for (let j = lines.length - 1; j > i; j -= 1) {
      const b = lines[j]
      if (b.section !== a.section || !sameKey(b) || b.ratioPct || a.ratioPct || locked(a, 'quantity') || b.lockedFields.length > 0) continue
      if (!a.name.trim()) continue
      const sum = (n(a.quantity) ?? 0) + (n(b.quantity) ?? 0)
      patch(lines, i, { quantity: String(sum) }, 'DUPLICATE', `「${a.name}」이 두 줄이라 한 줄로 합침 (수량 ${sum})`, fixes)
      fixes[fixes.length - 1].removed = { line: b, index: j }
      lines.splice(j, 1)
    }
  }
}

function rulesOf<K extends PriceRule['kind']>(p: PriceProduct, kind: K): Extract<PriceRule, { kind: K }>[] {
  return p.rules.filter((r): r is Extract<PriceRule, { kind: K }> => r.kind === kind)
}

function includedPaid(lines: FixLine[], products: readonly PriceProduct[], fixes: Fix[]): void {
  for (const p of products) {
    for (const r of rulesOf(p, 'INCLUDES')) {
      if (!r.items || !lines.some((l) => l.itemId === r.item)) continue
      const includer = p.items.find((i) => i.id === r.item)?.name ?? r.item
      lines.forEach((l, i) => {
        if (!l.itemId || !r.items?.includes(l.itemId) || (n(l.unitPriceMinor) ?? 0) === 0 || locked(l, 'unitPrice')) return
        patch(lines, i, { unitPriceMinor: '0', remark: `${includer} 기본 포함` }, 'INCLUDED_PAID',
          `「${l.name}」은 ${includer}에 기본 포함이라 따로 받지 않게 0원으로 고침`, fixes)
      })
    }
  }
}

/** GPU 라이선스 수량의 합 — QTY_FROM 이 GPU 를 가리키는 줄 */
function gpuTotal(lines: readonly FixLine[], p: PriceProduct): number {
  const gpuItems = new Set(rulesOf(p, 'QTY_FROM').filter((r) => r.varKey.startsWith('gpu.')).map((r) => r.item))
  return lines.filter((l) => l.itemId && gpuItems.has(l.itemId)).reduce((s, l) => s + (n(l.quantity) ?? 0), 0)
}

function capExceeded(lines: FixLine[], products: readonly PriceProduct[], fixes: Fix[]): void {
  for (const p of products) {
    const total = gpuTotal(lines, p)
    for (const cap of rulesOf(p, 'CAP')) {
      const i = lines.findIndex((l) => l.itemId === cap.item)
      if (i < 0 || cap.varKey !== 'gpu.total' || total <= cap.max || locked(lines[i], 'name')) continue
      const group = rulesOf(p, 'ONE_OF').find((g) => g.items.includes(cap.item))
      const alt = group?.items.map((id) => ({ id, cap: rulesOf(p, 'CAP').find((c) => c.item === id) }))
        .find((x) => x.id !== cap.item && (x.cap === undefined || x.cap.max >= total))
      const item = alt ? p.items.find((it) => it.id === alt.id) : undefined
      if (!item) continue
      const from = lines[i].name
      patch(lines, i, { itemId: item.id, name: item.name, unitPriceMinor: String(item.listPriceMinor ?? BigInt(0)), listPriceMinor: item.listPriceMinor === null ? null : String(item.listPriceMinor) },
        'CAP_EXCEEDED', `GPU ${total}장은 ${from} 상한 ${cap.max}장을 넘어 ${item.name}로 바꿈`, fixes)
      // 같이 들어가는 구축도 따라 바꾼다 — STD 기본 구축 → ENT 기본 구축
      const oldWith = rulesOf(p, 'WITH').find((w) => w.item === cap.item)?.with ?? []
      const newWith = rulesOf(p, 'WITH').find((w) => w.item === item.id)?.with ?? []
      oldWith.forEach((oldId, k) => {
        const j = lines.findIndex((l) => l.itemId === oldId)
        const w = p.items.find((it) => it.id === newWith[k])
        if (j < 0 || !w || locked(lines[j], 'name')) return
        patch(lines, j, { itemId: w.id, name: w.name, unitPriceMinor: String(w.listPriceMinor ?? BigInt(0)), listPriceMinor: w.listPriceMinor === null ? null : String(w.listPriceMinor), remark: w.remark ?? '' },
          'CAP_EXCEEDED', `에디션을 바꿔 ${lines[j].name}도 ${w.name}로 바꿈`, fixes)
      })
    }
  }
}

function ratioOrphans(lines: FixLine[], fixes: Fix[]): void {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i]
    if (!l.ratioPct || !l.ratioOfSectionName || locked(l, 'name')) continue
    const alive = lines.some((x) => x !== l && !x.ratioPct && x.section === l.ratioOfSectionName)
    if (alive) continue
    fixes.push({ code: 'RATIO_ORPHAN', key: l.key, note: `「${l.name}」의 대상 묶음 「${l.ratioOfSectionName}」이 없어 그 줄을 뺌`, before: {}, after: {}, removed: { line: l, index: i } })
    lines.splice(i, 1)
  }
}

export function autofix(input: readonly FixLine[], products: readonly PriceProduct[] = []): AutofixResult {
  const lines = input.map((l) => ({ ...l }))
  const fixes: Fix[] = []
  periodInQuantity(lines, fixes)
  priceScale(lines, fixes)
  duplicates(lines, fixes)
  includedPaid(lines, products, fixes)
  capExceeded(lines, products, fixes)
  ratioOrphans(lines, fixes)
  return { lines, fixes }
}

/** 되돌리기 — 그 고침 하나만 되돌린다. 지운 줄은 원래 자리에 다시 넣는다 */
export function undoFix(lines: readonly FixLine[], fix: Fix): FixLine[] {
  const out = lines.map((l) => (l.key === fix.key ? { ...l, ...fix.before } : l))
  if (fix.removed) {
    const at = Math.min(fix.removed.index, out.length)
    return [...out.slice(0, at), fix.removed.line, ...out.slice(at)]
  }
  return out
}
