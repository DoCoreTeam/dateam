/**
 * DB 줄 ↔ 엔진 모양 (순수 함수)
 *
 * 서비스가 DB 에서 읽은 제품, 품목, 규칙을 엔진의 `PriceProduct` 로 바꾸고,
 * 파일에서 읽은 `PriceProduct` 를 DB 에 쓸 줄로 바꾼다.
 * 칸을 「골라」 옮기는 자리가 새 축을 떨어뜨린 전례가 있어(총액 3억이 6억), 왕복 시험이 잠근다.
 */

import type {
  ItemBasis, PriceExample, PriceItem, PriceProduct, PriceRule, ProductSection, RuleKind,
} from '../domain/pricebook/types.ts'
import { ITEM_BASES, RULE_KINDS } from '../domain/pricebook/types.ts'
import type { Billing } from '../domain/quote-compose.ts'

export interface ProductDbRow {
  id: string
  name: string
  businessTypeKey: string
  descriptionMd?: string | null
  sections: unknown
  tcoYears: number
  freeYears: number
  examples: unknown
  isActive?: boolean
  needsReview?: boolean
  version?: number
}

export interface ItemDbRow {
  id: string
  name: string
  unitPriceMinor: bigint | string | number
  unit: string | null
  taxRate: string | number | { toString(): string }
  section: string | null
  basis: string
  billing: string
  ratioPct: string | number | { toString(): string } | null
  ratioOfSection: string | null
  discountable: boolean
  remark: string | null
  needsReview: boolean
  isActive?: boolean
  position?: number
}

export interface RuleDbRow {
  id?: string
  kind: string
  body: unknown
  isEnabled: boolean
  position?: number
}

const DEFAULT_SECTION = '기타'

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v === null || v === undefined ? NaN : String(v))
  return Number.isFinite(n) ? n : fallback
}

function basisOf(v: string): ItemBasis {
  return (ITEM_BASES as readonly string[]).includes(v) ? (v as ItemBasis) : 'FIXED'
}

function billingOf(v: string): Billing {
  return v === 'ANNUAL' ? 'ANNUAL' : 'ONCE'
}

export function sectionsOf(v: unknown): ProductSection[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((s): s is { name: unknown; roundingUnit?: unknown } => typeof s === 'object' && s !== null && 'name' in s)
    .map((s) => ({ name: String(s.name), roundingUnit: asNumber(s.roundingUnit, 0) }))
    .filter((s) => s.name.trim() !== '')
}

/** 계산 예시 — JSON 에는 bigint 가 없어 금액을 문자열로 둔다 */
export function examplesOf(v: unknown): PriceExample[] {
  if (!Array.isArray(v)) return []
  const out: PriceExample[] = []
  for (const e of v) {
    if (typeof e !== 'object' || e === null) continue
    const x = e as Record<string, unknown>
    if (typeof x.conditions !== 'object' || x.conditions === null) continue
    try {
      out.push({
        label: String(x.label ?? ''),
        conditions: x.conditions as PriceExample['conditions'],
        expectOnceMinor: BigInt(String(x.expectOnceMinor ?? '0')),
        expectAnnualMinor: BigInt(String(x.expectAnnualMinor ?? '0')),
        expectTcoMinor: x.expectTcoMinor === null || x.expectTcoMinor === undefined ? null : BigInt(String(x.expectTcoMinor)),
      })
    } catch {
      continue
    }
  }
  return out
}

export function examplesToJson(xs: readonly PriceExample[]): Record<string, unknown>[] {
  return xs.map((x) => ({
    label: x.label,
    conditions: x.conditions,
    expectOnceMinor: x.expectOnceMinor.toString(),
    expectAnnualMinor: x.expectAnnualMinor.toString(),
    expectTcoMinor: x.expectTcoMinor === null || x.expectTcoMinor === undefined ? null : x.expectTcoMinor.toString(),
  }))
}

export function itemFromRow(r: ItemDbRow): PriceItem {
  const basis = basisOf(r.basis)
  const price = BigInt(String(r.unitPriceMinor ?? '0'))
  return {
    id: r.id,
    name: r.name,
    section: r.section && r.section.trim() !== '' ? r.section : DEFAULT_SECTION,
    listPriceMinor: basis === 'SURVEY' || basis === 'RATIO' ? null : price,
    basis,
    unit: r.unit,
    billing: billingOf(r.billing),
    ratioPct: r.ratioPct === null ? null : asNumber(r.ratioPct, 0),
    ratioOfSection: r.ratioOfSection,
    discountable: r.discountable,
    taxRate: asNumber(r.taxRate, 10),
    remark: r.remark,
    needsReview: r.needsReview,
  }
}

/** 규칙 본문은 kind 를 뺀 나머지다. 모르는 종류는 버리지 않고 null 로 돌려 부르는 쪽이 「끈 규칙」으로 센다 */
export function ruleFromRow(r: RuleDbRow): PriceRule | null {
  if (!(RULE_KINDS as readonly string[]).includes(r.kind)) return null
  const body = typeof r.body === 'object' && r.body !== null ? (r.body as Record<string, unknown>) : {}
  return { ...body, kind: r.kind as RuleKind } as PriceRule
}

export function ruleToRow(rule: PriceRule, position: number): { kind: string; body: Record<string, unknown>; position: number } {
  const { kind, ...body } = rule
  return { kind, body: body as Record<string, unknown>, position }
}

/**
 * 엔진에 넘길 제품. 판매 중지 품목과 꺼 둔 규칙은 빠진다.
 * 묶음 목록이 비면 품목이 처음 나온 순서로 세운다.
 */
export function toEngineProduct(p: ProductDbRow, items: readonly ItemDbRow[], rules: readonly RuleDbRow[]): PriceProduct {
  const live = [...items].filter((i) => i.isActive !== false).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const priceItems = live.map(itemFromRow)
  const declared = sectionsOf(p.sections)
  const known = new Set(declared.map((s) => s.name))
  const sections = [...declared]
  for (const it of priceItems) {
    if (!known.has(it.section)) { known.add(it.section); sections.push({ name: it.section, roundingUnit: 0 }) }
  }
  const engineRules = [...rules]
    .filter((r) => r.isEnabled)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(ruleFromRow)
    .filter((r): r is PriceRule => r !== null)
  return {
    id: p.id,
    name: p.name,
    businessTypeKey: p.businessTypeKey,
    sections,
    items: priceItems,
    rules: engineRules,
    tcoYears: p.tcoYears,
    freeYears: p.freeYears,
    examples: examplesOf(p.examples),
  }
}

/** 엔진 품목 → DB 에 쓸 칸. 정상가가 없으면(실사 후 견적, 비율) 0 을 쓴다 */
export function itemToData(it: PriceItem, position: number): Record<string, unknown> {
  return {
    name: it.name,
    unitPriceMinor: it.listPriceMinor ?? BigInt(0),
    unit: it.unit,
    taxRate: it.taxRate,
    section: it.section,
    basis: it.basis,
    billing: it.billing,
    ratioPct: it.ratioPct ?? null,
    ratioOfSection: it.ratioOfSection ?? null,
    discountable: it.discountable,
    remark: it.remark ?? null,
    needsReview: it.needsReview ?? false,
    position,
  }
}
