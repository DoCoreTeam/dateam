/**
 * 글에서 읽은 조건 → 견적 표 (순수 함수)
 *
 * 금액은 여기서 세지 않는다. 솔루션은 `buildSolutionQuote`, 공수는 `laborLine`,
 * GPU 이용은 `gpuUsageLine` 이 단가와 수량을 정하고, 합계는 저장과 화면이 같이 쓰는 `priceQuote` 가 센다.
 * 이 파일은 「어느 조건을 어느 엔진에 넣을까」와 「어느 글 줄에서 왔나」만 안다.
 *
 * 줄마다 `textKey` 가 붙는다. 같은 글을 다시 읽으면 같은 키가 나오고, 그래서 다시 정리해도
 * 바뀐 줄만 바뀐다(`merge-text-lines.ts`).
 */

import type { CompanyKind } from '../company-kind.ts'
import { buildSolutionQuote } from '../pricebook/solution-engine.ts'
import { gpuUsageLine, laborLine, type GpuPriceRef, type LaborGradeRef } from '../pricebook/basis-lines.ts'
import type { PriceProduct, Provenance, SolutionConditions, Violation } from '../pricebook/types.ts'
import type { Reading } from './read-rules.ts'
import { HOURS_PER_MONTH } from '../../../gpu/hours.ts'

/** 제품에 안 묶인 품목 — 크레딧, 하드웨어. 가격은 정상가만(원가는 싣지 않는다) */
export interface StandaloneItem {
  id: string
  name: string
  unit: string | null
  listPriceMinor: bigint | null
  /** 묶음 이름 — 비면 품목 이름 */
  section: string | null
  taxRate: number
}

export interface ComposeContext {
  products: readonly PriceProduct[]
  items: readonly StandaloneItem[]
  laborGrades: readonly LaborGradeRef[]
  gpuPrice: (model: string) => GpuPriceRef | null
  /** 딜 회사에서 읽은 기관 종류 — 글에 없을 때만 쓴다 */
  companyKind: CompanyKind | null
  /** 이 회사가 지난 계약에서 이미 산 품목과 근거 — 전환 품목이 본다 */
  owned?: { itemIds: readonly string[]; evidence: Readonly<Record<string, string>> }
}

export type TextLineKind = 'QUANTITY' | 'EFFORT' | 'PERIOD' | 'RATIO'

export interface TextLine {
  /** 같은 글이면 같은 키 — 다시 정리할 때 이 키로 맞춘다 */
  textKey: string
  /** 이 줄이 나온 글 줄 번호들 — 화면이 글과 표를 서로 가리킨다 */
  fromLines: number[]
  section: string
  itemId: string | null
  laborGradeId: string | null
  name: string
  kind: TextLineKind
  quantity: number
  unit: string
  /** null 이면 가격표에 없음 — 사람이 채운다 */
  unitPriceMinor: bigint | null
  listPriceMinor: bigint | null
  discountPercent: number
  taxRate: number
  billing: 'ONCE' | 'ANNUAL'
  ratioPct: number | null
  ratioOfSection: string | null
  durationValue: number | null
  durationUnit: 'MONTH' | 'HOUR' | null
  priceBasis: 'HOUR' | 'MONTH' | null
  hoursPerMonth: number | null
  priceSource: 'LIST' | 'LABOR' | 'GPU' | 'MANUAL'
  remark: string | null
  discountable: boolean
  provenance: Record<string, Provenance>
}

export interface TextSection {
  name: string
  roundingUnit: number
}

export interface Noted {
  field: string
  value: string
  provenance: Provenance
}

export interface TextQuote {
  sections: TextSection[]
  lines: TextLine[]
  /** 엔진이 말하지 않은 칸을 채운 것 */
  autoFilled: Noted[]
  /** 글을 읽으며 고친 것 — 「노드 30대」→ 추가 노드 10대, 「설치」는 줄 없음 */
  autoFixed: Noted[]
  violations: Violation[]
  budgetMinor: bigint | null
  budgetIncludesTax: boolean
  /** 제품으로 채운 조건 — 조건 고치기가 다시 채운다 */
  conditions: { productId: string; productName: string; conditions: SolutionConditions } | null
}

const SAID: Provenance = { source: 'SAID' }
const DEFAULT_GRADE: Provenance = { source: 'DEFAULT', note: '기본값' }
const won = (v: bigint | number) => Number(v).toLocaleString('ko-KR')
const LABOR_SECTION = 'SI'
const GPU_SECTION = 'GPU 이용'
const SAID_SECTION = '직접 입력'

/** 키는 줄 번호가 아니라 내용으로 짓는다 — 위 줄을 지워도 아래 줄의 키가 그대로여야 한다 */
function keyOf(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

/** 같은 키가 두 번 나오면 #2, #3 을 붙인다 */
function uniqueKeys(lines: readonly TextLine[]): TextLine[] {
  const seen = new Map<string, number>()
  return lines.map((l) => {
    const n = (seen.get(l.textKey) ?? 0) + 1
    seen.set(l.textKey, n)
    return n === 1 ? l : { ...l, textKey: `${l.textKey}#${n}` }
  })
}

function first<T>(rs: readonly Reading[], pick: (r: Reading) => T | null): T | null {
  for (const r of rs) {
    const v = pick(r)
    if (v !== null) return v
  }
  return null
}

/** 이 조각이 제품 조건에 들어가나 — 제품, 에디션, 노드, 교육, 유지보수, 기간 없는 GPU */
function feedsProduct(r: Reading): boolean {
  return r.productId !== null || r.edition !== null || r.nodes !== null || r.training !== null
    || r.maintenance !== null || r.priorEdition !== null || (r.gpus.length > 0 && r.months === null && r.hours === null)
}

function editionItemId(p: PriceProduct, edition: 'STD' | 'ENT'): string | null {
  return p.items.find((i) => new RegExp(`^${edition}\\b`).test(i.name) && i.basis === 'FIXED')?.id ?? null
}

function maintenanceItemId(p: PriceProduct, m: 'STD' | 'EXT'): string | null {
  const word = m === 'STD' ? '표준' : '확장'
  return p.items.find((i) => i.name.includes('유지보수') && i.name.includes(word))?.id ?? null
}

interface Built {
  sections: TextSection[]
  lines: TextLine[]
  autoFilled: Noted[]
  autoFixed: Noted[]
  violations: Violation[]
  conditions: TextQuote['conditions']
}

const EMPTY: Built = { sections: [], lines: [], autoFilled: [], autoFixed: [], violations: [], conditions: null }

function productPart(rs: readonly Reading[], ctx: ComposeContext, companyKind: CompanyKind | null, discountPct: number | null): Built {
  const mine = rs.filter(feedsProduct)
  if (mine.length === 0) return EMPTY
  const productId = first(mine, (r) => r.productId)
  const product = ctx.products.find((p) => p.id === productId) ?? (ctx.products.length === 1 ? ctx.products[0] : null)
  if (!product) return EMPTY

  const edition = first(mine, (r) => r.edition)
  const maintenance = first(mine, (r) => r.maintenance)
  const itemIds = new Set(product.items.map((i) => i.id))
  const picked = [
    edition ? editionItemId(product, edition) : null,
    maintenance ? maintenanceItemId(product, maintenance) : null,
    ...mine.flatMap((r) => r.itemIds.filter((id) => itemIds.has(id))),
  ].filter((id): id is string => id !== null)
  // 이미 산 품목: 지난 계약 + 글의 「기존 STD 고객」
  const prior = first(mine, (r) => r.priorEdition)
  const priorItem = prior ? editionItemId(product, prior) : null
  const owned = [...new Set([...(ctx.owned?.itemIds ?? []), ...(priorItem ? [priorItem] : [])])]
  const ownedNote = owned.map((id) => ctx.owned?.evidence[id]).find(Boolean) ?? (priorItem ? `글: 「기존 ${prior} 고객」` : null)
  const conditions: SolutionConditions = {
    owned,
    ownedNote,
    picked: [...new Set(picked)],
    gpus: mine.flatMap((r) => (r.months === null && r.hours === null ? r.gpus : []))
      .filter((g) => g.count !== null)
      .map((g) => ({ model: g.model, count: g.count ?? 0, timed: false })),
    nodes: first(mine, (r) => r.nodes),
    training: first(mine, (r) => r.training),
    companyKind,
    discount: discountPct ?? 'auto',
  }
  const result = buildSolutionQuote(product, conditions)
  const fromLines = [...new Set(mine.map((r) => r.line))]
  const autoFixed: Noted[] = []
  const saidNodes = conditions.nodes
  const nodeLine = result.lines.find((l) => /노드/.test(l.name) && Number(l.quantity) > 0 && l.provenance.quantity.source === 'RULE')
  if (saidNodes !== null && nodeLine) {
    const included = saidNodes - Number(nodeLine.quantity)
    autoFixed.push({
      field: nodeLine.name,
      value: `${nodeLine.quantity}${nodeLine.unit ?? ''}`,
      provenance: { source: 'RULE', note: `「노드 ${saidNodes}대」를 읽어 ${nodeLine.name} ${nodeLine.quantity}${nodeLine.unit ?? ''}를 더함 (${saidNodes}대에서 기본 포함 ${included}대를 뺌)` },
    })
  }
  const install = rs.find((r) => r.install && !feedsProduct(r))
  if (install && result.lines.some((l) => l.sectionKey && /구축/.test(l.sectionKey))) {
    autoFixed.push({ field: '설치', value: '줄 없음', provenance: { source: 'RULE', note: `「${install.text}」은 기본 구축에 들어 있어 따로 줄을 만들지 않음` } })
  }

  return {
    sections: product.sections.filter((s) => result.lines.some((l) => l.sectionKey === s.name)).map((s) => ({ name: s.name, roundingUnit: s.roundingUnit })),
    lines: result.lines.map((l) => ({
      textKey: `prod:${product.id}:${l.itemId}`,
      fromLines,
      section: l.sectionKey ?? product.name,
      itemId: l.itemId,
      laborGradeId: null,
      name: l.name,
      kind: l.ratioPct ? 'RATIO' : 'QUANTITY',
      quantity: Number(l.quantity),
      unit: l.unit ?? '',
      unitPriceMinor: BigInt(l.unitPriceMinor),
      listPriceMinor: l.listPriceMinor,
      discountPercent: Number(l.discountPercent ?? 0),
      taxRate: Number(l.taxRate ?? 10),
      billing: l.billing === 'ANNUAL' ? 'ANNUAL' : 'ONCE',
      ratioPct: l.ratioPct ? Number(l.ratioPct) : null,
      ratioOfSection: l.ratioOfSectionKey ?? null,
      durationValue: null, durationUnit: null, priceBasis: null, hoursPerMonth: null,
      priceSource: 'LIST',
      remark: l.remark,
      discountable: l.discountable,
      provenance: l.provenance,
    })),
    autoFilled: result.autoFilled,
    autoFixed,
    violations: result.violations,
    conditions: { productId: product.id, productName: product.name, conditions: result.resolved },
  }
}

function laborPart(rs: readonly Reading[], ctx: ComposeContext): { lines: TextLine[]; autoFilled: Noted[] } {
  const autoFilled: Noted[] = []
  const lines = rs.filter((r) => r.manMonths !== null || (r.grade !== null && r.months !== null)).flatMap((r) => {
    const people = r.counts.find((c) => c.unit === '명')?.value ?? null
    const line = laborLine(r.rest || '개발', {
      grade: r.grade,
      headcount: r.manMonths !== null ? 1 : people,
      months: r.manMonths ?? r.months,
    }, ctx.laborGrades)
    if (!line) return []
    autoFilled.push(...line.autoFilled)
    return [{
      textKey: `labor:${keyOf(r.rest || '개발')}`,
      fromLines: [r.line],
      section: LABOR_SECTION,
      itemId: null,
      laborGradeId: line.laborGradeId,
      name: line.name,
      kind: 'EFFORT' as const,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceMinor: line.unitPriceMinor,
      listPriceMinor: line.listPriceMinor,
      discountPercent: 0,
      taxRate: 10,
      billing: 'ONCE' as const,
      ratioPct: null, ratioOfSection: null,
      durationValue: null, durationUnit: null, priceBasis: null, hoursPerMonth: null,
      priceSource: 'LABOR' as const,
      remark: r.grade ? `${r.grade}` : null,
      discountable: true,
      provenance: { ...line.provenance, grade: r.grade ? SAID : DEFAULT_GRADE },
    }]
  })
  return { lines, autoFilled }
}

function gpuPart(rs: readonly Reading[], ctx: ComposeContext): TextLine[] {
  return rs.filter((r) => r.gpus.length > 0 && (r.months !== null || r.hours !== null) && r.productId === null).flatMap((r) =>
    r.gpus.map((g) => {
      const count = g.count ?? r.counts.find((c) => c.unit === '대' || c.unit === '장')?.value ?? 1
      const months = r.months ?? (r.hours !== null ? Math.round((r.hours / HOURS_PER_MONTH) * 100) / 100 : null)
      const price = ctx.gpuPrice(g.model)
      const line = gpuUsageLine({ model: g.model, count, months }, price)
      const base = {
        textKey: `gpu:${keyOf(g.model)}`,
        fromLines: [r.line],
        section: GPU_SECTION,
        itemId: null,
        laborGradeId: null,
        kind: 'PERIOD' as const,
        discountPercent: 0,
        taxRate: 10,
        billing: 'ONCE' as const,
        ratioPct: null, ratioOfSection: null,
        priceSource: 'GPU' as const,
        discountable: true,
      }
      if (line) {
        return {
          ...base, name: line.name, quantity: line.quantity, unit: line.unit,
          unitPriceMinor: line.unitPriceMinor, listPriceMinor: line.listPriceMinor,
          durationValue: line.durationValue, durationUnit: line.durationUnit, priceBasis: line.priceBasis, hoursPerMonth: line.hoursPerMonth,
          remark: line.formula, provenance: line.provenance,
        }
      }
      return {
        ...base, name: `${g.model} GPU 이용`, quantity: count, unit: '대',
        unitPriceMinor: null, listPriceMinor: null,
        durationValue: months, durationUnit: 'MONTH' as const, priceBasis: 'MONTH' as const, hoursPerMonth: HOURS_PER_MONTH,
        remark: null, provenance: { unitPrice: { source: 'UNVERIFIED' as const, note: '가격표에 없음' }, quantity: SAID },
      }
    }),
  )
}

/** 따로 있는 품목과 말한 금액 줄 — 「크레딧 2.8억」, 「서버 랙 3식」 */
function itemPart(rs: readonly Reading[], ctx: ComposeContext, taken: ReadonlySet<Reading>): TextLine[] {
  const byId = new Map(ctx.items.map((i) => [i.id, i]))
  const out: TextLine[] = []
  for (const r of rs) {
    if (taken.has(r)) continue
    const item = r.itemIds.map((id) => byId.get(id)).find((i) => i !== undefined) ?? null
    const count = r.counts[0] ?? null
    if (!item && r.amountMinor === null && !(count && r.rest)) continue
    const quantity = count?.value ?? 1
    const said = r.amountMinor !== null && r.budgetMinor === null
    // 말한 금액이 있으면 그 금액이 1식 금액이다 — 「크레딧 2.8억」
    const unitPrice = said ? (count && count.unit !== '식' ? (r.amountMinor ?? BigInt(0)) / BigInt(quantity) : r.amountMinor) : (item?.listPriceMinor ?? null)
    const name = item?.name ?? r.rest
    if (!name) continue
    out.push({
      textKey: item ? `item:${item.id}` : `said:${keyOf(name)}`,
      fromLines: [r.line],
      section: item ? (item.section ?? item.name) : SAID_SECTION,
      itemId: item?.id ?? null,
      laborGradeId: null,
      name,
      kind: 'QUANTITY',
      quantity: said && (!count || count.unit === '식') ? 1 : quantity,
      unit: said && !count ? '식' : (count?.unit ?? item?.unit ?? '식'),
      unitPriceMinor: unitPrice,
      listPriceMinor: item?.listPriceMinor ?? null,
      discountPercent: 0,
      taxRate: item?.taxRate ?? 10,
      billing: 'ONCE',
      ratioPct: null, ratioOfSection: null,
      durationValue: null, durationUnit: null, priceBasis: null, hoursPerMonth: null,
      priceSource: item && !said ? 'LIST' : 'MANUAL',
      remark: said && item ? `${won(r.amountMinor ?? 0)}원 (말한 값)` : null,
      discountable: true,
      provenance: {
        unitPrice: said ? SAID : unitPrice !== null ? { source: 'PRICEBOOK', note: '품목 정상가' } : { source: 'UNVERIFIED', note: '가격표에 없음' },
        quantity: count ? SAID : { source: 'DEFAULT', note: '1식' },
      },
    })
  }
  return out
}

function sectionsOf(lines: readonly TextLine[], fixed: readonly TextSection[]): TextSection[] {
  const out = [...fixed]
  for (const l of lines) if (!out.some((s) => s.name === l.section)) out.push({ name: l.section, roundingUnit: 0 })
  return out
}

export function composeFromText(readings: readonly Reading[], ctx: ComposeContext): TextQuote {
  const companyKind = first(readings, (r) => r.companyKind) ?? ctx.companyKind
  const discountPct = first(readings, (r) => r.discountPct)
  const budgetMinor = first(readings, (r) => r.budgetMinor)
  const vat = first(readings, (r) => r.vat)

  const prod = productPart(readings, ctx, companyKind, discountPct)
  const labor = laborPart(readings, ctx)
  const gpu = gpuPart(readings, ctx)
  const taken = new Set(readings.filter((r) => feedsProduct(r) || r.manMonths !== null || (r.grade !== null && r.months !== null)
    || (r.gpus.length > 0 && (r.months !== null || r.hours !== null))))
  const items = itemPart(readings, ctx, taken)

  // 묶음 순서는 글 순서 — 크레딧을 먼저 쓰면 크레딧 묶음이 1번이다
  const lines = uniqueKeys([...items, ...prod.lines, ...labor.lines, ...gpu]).sort((a, b) => Math.min(...a.fromLines) - Math.min(...b.fromLines))
  return {
    sections: sectionsOf(lines, []).map((s) => prod.sections.find((p) => p.name === s.name) ?? s),
    lines,
    autoFilled: [...prod.autoFilled, ...labor.autoFilled],
    autoFixed: prod.autoFixed,
    violations: prod.violations,
    budgetMinor,
    budgetIncludesTax: vat === 'INCLUDED',
    conditions: prod.conditions,
  }
}
