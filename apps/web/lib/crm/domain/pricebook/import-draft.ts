/**
 * 가격표 파일 읽기 → 가져오기 초안 (순수 함수)
 *
 * AI 는 **문서에 적힌 그대로**만 낸다 — 숫자도 단위를 곱하지 않은 원문 숫자다.
 * 단위를 곱하고, 품목 이름을 id 로 잇고, 검증 2~6 을 거는 일은 여기 규칙이 한다.
 * AI 가 읽은 결과를 AI 가 다시 검사하지 않는다.
 *
 * 걸린 줄도 채운 채로 둔다(자동 채움을 원하셨다). 대신 「확인 전」 표시가 붙고,
 * 확인 전 품목은 견적의 자동 채움 기준으로 안 쓰인다(엔진이 UNVERIFIED 로 낸다).
 */

import type { CompanyKind } from '../company-kind.ts'
import { ITEM_BASES, RULE_KINDS, type ItemBasis, type PriceExample, type PriceItem, type PriceProduct, type PriceRule, type ProductSection } from './types.ts'
import { amountInSource, checkExamples, checkRules, diffItems, sourceUnitOf, unitProblems, type ExampleCheck, type ProductDiff } from './validate.ts'

export type ImportTarget = 'product' | 'items' | 'labor'

/** AI 가 내는 모양 — 금액은 원문 숫자 그대로, 품목은 이름으로 가리킨다 */
export interface PriceSheetRead {
  unit: '원' | '천원' | '만원' | '백만원' | '억원' | null
  product: { name: string; businessType: string | null } | null
  sections: { name: string; roundingUnitWon: number | null }[]
  items: {
    name: string
    section: string | null
    price: number | null
    basis: string | null
    unit: string | null
    billing: string | null
    ratioPct: number | null
    ratioOfSection: string | null
    discountable: boolean | null
    remark: string | null
    sourceText: string | null
  }[]
  rules: Record<string, unknown>[]
  discounts: { label: string; companyKind: string; pct: number; confirmed: boolean | null }[]
  examples: {
    label: string
    picked: string[]
    gpus: { model: string; count: number; timed: boolean }[]
    nodes: number | null
    expectOnce: number | null
    expectAnnual: number | null
    expectTco: number | null
  }[]
  grades: { name: string; publicRate: number | null; price: number | null; effectiveFrom: string | null; sourceText: string | null }[]
  unclear: string[]
}

export interface DraftItem extends PriceItem {
  /** 원문에서 못 찾았거나 단위가 의심스러운 사유 */
  problems: string[]
  sourceText: string | null
}

export interface DraftGrade {
  name: string
  publicRateMinor: bigint | null
  pricePerMmMinor: bigint | null
  effectiveFrom: string | null
  problems: string[]
}

export interface ImportDraft {
  target: ImportTarget
  product: { name: string; businessTypeKey: string } | null
  sections: ProductSection[]
  items: DraftItem[]
  /** 규칙. 모양이 틀린 것은 disabledReason 이 있고 끈 채로 저장된다 */
  rules: { rule: PriceRule; disabledReason: string | null }[]
  examples: PriceExample[]
  exampleChecks: ExampleCheck[]
  grades: DraftGrade[]
  diff: ProductDiff | null
  /** 제품 전체를 「확인 전」으로 — 단위(3)나 계산 예시(5)에 걸렸다 */
  productNeedsReview: boolean
  notes: string[]
  /** 원문 대조를 했나. 그림째 읽어 원문 글이 없으면 못 한다 */
  sourceChecked: boolean
}

const UNIT_WON: Record<string, number> = { 원: 1, 천원: 1_000, 만원: 10_000, 백만원: 1_000_000, 억원: 100_000_000 }
const COMPANY_KINDS: readonly string[] = ['school', 'government', 'public', 'research', 'company', 'nonprofit', 'partner']
const BUSINESS_TYPES: readonly string[] = ['GPU', 'SI', 'SOLUTION', 'HARDWARE', 'MSP', 'PROJECT', 'CREDIT', 'OTHER']

function toMinor(v: number | null, mult: number): bigint | null {
  if (v === null || !Number.isFinite(v) || v < 0) return null
  return BigInt(Math.round(v * mult))
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

export function itemId(index: number): string {
  return `new:${index}`
}

/** 규칙의 품목 이름을 초안 id 로. 못 이은 이름은 그대로 두어 checkRules 가 「없는 품목」으로 짚는다 */
function mapRuleNames(raw: Record<string, unknown>, idOf: (name: string) => string | null): PriceRule | null {
  const kind = String(raw.kind ?? '')
  if (!(RULE_KINDS as readonly string[]).includes(kind)) return null
  const one = (v: unknown) => (typeof v === 'string' ? idOf(v) ?? v : '')
  const many = (v: unknown) => (Array.isArray(v) ? v.map(one).filter(Boolean) : [])
  const out: Record<string, unknown> = { ...raw, kind }
  if ('item' in raw) out.item = one(raw.item)
  if ('items' in raw) out.items = many(raw.items)
  if ('with' in raw) out.with = many(raw.with)
  return out as unknown as PriceRule
}

export interface ExistingItem { id: string; name: string; listPriceMinor: bigint | null }

export function buildImportDraft(
  target: ImportTarget,
  read: PriceSheetRead,
  rawText: string,
  existing: readonly ExistingItem[] = [],
): ImportDraft {
  const notes: string[] = []
  const sourceChecked = rawText.trim().length > 0
  const docUnit = sourceUnitOf(rawText)
  const aiUnit = read.unit ? UNIT_WON[read.unit] ?? null : null
  // 원문에서 단위를 찾으면 그것이 이긴다 — AI 가 단위를 잘못 읽어도 규칙이 바로잡는다
  const mult = docUnit ?? aiUnit ?? 1
  if (docUnit && aiUnit && docUnit !== aiUnit) notes.push('AI 가 읽은 단위와 원문 단위가 달라 원문 단위로 셌어요')

  const items: DraftItem[] = read.items.map((r, i): DraftItem => {
    const basis: ItemBasis = (ITEM_BASES as readonly string[]).includes(String(r.basis)) ? (r.basis as ItemBasis) : 'FIXED'
    const price = basis === 'RATIO' || basis === 'SURVEY' ? null : toMinor(r.price, mult)
    const problems: string[] = []
    if (basis !== 'RATIO' && basis !== 'SURVEY' && price === null) problems.push('금액을 못 읽었어요')
    if (sourceChecked && price !== null && price > BigInt(0) && !amountInSource(price, rawText, docUnit)) problems.push('이 숫자를 원문에서 못 찾았어요')
    return {
      id: itemId(i),
      name: r.name.trim(),
      section: (r.section ?? '').trim() || '기타',
      listPriceMinor: price,
      basis,
      unit: r.unit,
      billing: r.billing === 'ANNUAL' ? 'ANNUAL' as const : 'ONCE' as const,
      ratioPct: basis === 'RATIO' ? r.ratioPct : null,
      ratioOfSection: basis === 'RATIO' ? r.ratioOfSection : null,
      discountable: r.discountable ?? true,
      taxRate: 10,
      remark: r.remark,
      needsReview: false,
      problems,
      sourceText: r.sourceText,
    }
  }).filter((it) => it.name !== '')

  // 3 단위 — 혼자 자릿수가 튄 줄은 그 줄만, 원문 단위를 못 찾았는데 AI 단위도 없으면 제품 전체를 확인 전으로
  const unitBad = new Set(unitProblems(items.map((it) => ({ id: it.id, minor: it.listPriceMinor })), rawText))
  for (const it of items) if (unitBad.has(it.id)) it.problems.push('단위를 곱하지 않은 것 같아요')
  let productNeedsReview = unitBad.size > 0
  if (!docUnit && !aiUnit && items.some((it) => it.listPriceMinor !== null)) {
    notes.push('원문에서 단위를 못 찾아 원 단위로 셌어요')
  }
  for (const it of items) it.needsReview = it.problems.length > 0

  const idOf = (name: string) => items.find((it) => norm(it.name) === norm(name))?.id ?? null
  const rawRules = [
    ...read.rules,
    ...read.discounts
      .filter((d) => COMPANY_KINDS.includes(d.companyKind))
      .map((d) => ({ kind: 'DISCOUNT', companyKind: d.companyKind as CompanyKind | 'partner', pct: d.pct, confirmed: d.confirmed === true, label: d.label })),
  ]
  // 규모 조정의 단위 금액도 문서 숫자 그대로 온다 — 다른 금액과 같은 단위를 곱한다
  const withUnits = rawRules.map((r) => (r.kind === 'SCALE_CAP' && 'perUnitWon' in r
    ? { ...r, perUnitMinor: Math.round(Number((r as { perUnitWon: unknown }).perUnitWon) * mult) }
    : r))
  const mapped = withUnits.map((r) => mapRuleNames(r, idOf)).filter((r): r is PriceRule => r !== null)

  // AI 가 빠뜨린 관계를 규칙이 채운다 — 같은 글에 다른 답이 와도 이 부분은 늘 같다
  const completed = completeRules(items, mapped)
  if (completed.added > 0) notes.push(`품목 이름과 비고에서 규칙 ${completed.added}개를 채웠어요`)
  mapped.splice(0, mapped.length, ...completed.rules)

  const sections: ProductSection[] = read.sections.map((s) => ({ name: s.name.trim(), roundingUnit: s.roundingUnitWon && s.roundingUnitWon > 1 ? s.roundingUnitWon : 0 }))
    .filter((s) => s.name !== '')
  const typeKey = read.product?.businessType && BUSINESS_TYPES.includes(read.product.businessType) ? read.product.businessType : 'SOLUTION'
  const engineProduct: PriceProduct = {
    id: 'draft', name: read.product?.name ?? '', businessTypeKey: typeKey, sections, items,
    rules: mapped, tcoYears: 5, freeYears: 1,
  }
  // 4 규칙 모양 — 걸린 규칙은 끈 채로
  const problems = checkRules(engineProduct)
  const reasonOf = new Map<number, string>()
  for (const p of problems) if (!reasonOf.has(p.index)) reasonOf.set(p.index, p.message)
  const rules = mapped.map((rule, i) => ({ rule, disabledReason: reasonOf.get(i) ?? null }))

  // 5 계산 예시 재현 — 꺼진 규칙은 빼고 센다
  const examples: PriceExample[] = read.examples.flatMap((e) => {
    const once = toMinor(e.expectOnce, mult)
    const annual = toMinor(e.expectAnnual, mult)
    if (once === null || annual === null) return []
    return [{
      label: e.label,
      conditions: {
        picked: e.picked.map((n) => idOf(n)).filter((x): x is string => x !== null),
        gpus: e.gpus, nodes: e.nodes, training: null, companyKind: null, discount: 'none' as const,
      },
      expectOnceMinor: once,
      expectAnnualMinor: annual,
      expectTcoMinor: toMinor(e.expectTco, mult),
    }]
  })
  const exampleChecks = target === 'product'
    ? checkExamples({ ...engineProduct, rules: rules.filter((r) => !r.disabledReason).map((r) => r.rule), examples })
    : []
  if (exampleChecks.some((c) => !c.ok)) productNeedsReview = true

  const grades: DraftGrade[] = read.grades.map((g) => {
    const pub = toMinor(g.publicRate, mult)
    const price = toMinor(g.price, mult)
    const gp: string[] = []
    if (sourceChecked) {
      for (const v of [pub, price]) if (v !== null && v > BigInt(0) && !amountInSource(v, rawText, docUnit)) gp.push('이 숫자를 원문에서 못 찾았어요')
    }
    return { name: g.name.trim(), publicRateMinor: pub, pricePerMmMinor: price, effectiveFrom: g.effectiveFrom, problems: gp }
  }).filter((g) => g.name !== '')

  const diff = existing.length > 0 ? diffItems(existing, items) : null
  if (read.unclear.length) notes.push(...read.unclear.slice(0, 10))

  return {
    target,
    product: target === 'product' ? { name: read.product?.name?.trim() || '이름 없는 제품', businessTypeKey: typeKey } : null,
    sections,
    items,
    rules,
    examples,
    exampleChecks,
    grades,
    diff,
    productNeedsReview,
    notes,
    sourceChecked,
  }
}

const QTY_HINTS: { re: RegExp; varKey: 'gpu.dc' | 'gpu.ws' | 'gpu.timed' | 'nodes' | 'training'; minus?: boolean }[] = [
  { re: /지정\s*시간/, varKey: 'gpu.timed' },
  { re: /데이터\s*센터/, varKey: 'gpu.dc' },
  { re: /(워크스테이션|데스크톱|일반|npu)/i, varKey: 'gpu.ws' },
  { re: /노드/, varKey: 'nodes', minus: true },
  { re: /교육/, varKey: 'training' },
]

/**
 * 품목 이름과 비고로 빠진 규칙을 채운다(AI 없이, 늘 같은 답).
 *   · 단위당 품목인데 수량 규칙이 없으면 이름으로: 지정 시간, 데이터센터, 워크스테이션 데스크톱 일반 NPU, 노드, 교육
 *   · 「노드 20대 포함」이 비고나 원문 줄에 있으면 그 품목이 노드 20 을 기본 포함
 *   · 「STD 기본 구축」은 「STD」로 시작하는 에디션과 같이 들어간다
 * 이미 있는 규칙은 건드리지 않는다.
 */
export function completeRules(items: readonly DraftItem[], rules: readonly PriceRule[]): { rules: PriceRule[]; added: number } {
  const out = [...rules]
  const has = (pred: (r: PriceRule) => boolean) => out.some(pred)
  let added = 0
  for (const it of items) {
    if (it.basis !== 'PER_UNIT') continue
    if (has((r) => r.kind === 'QTY_FROM' && r.item === it.id)) continue
    const hint = QTY_HINTS.find((h) => h.re.test(it.name))
    if (!hint) continue
    out.push({ kind: 'QTY_FROM', item: it.id, varKey: hint.varKey, ...(hint.minus ? { minusIncluded: true } : {}) })
    added++
  }
  for (const it of items) {
    const text = `${it.remark ?? ''} ${it.sourceText ?? ''}`
    const m = /노드\s*(\d+)\s*대\s*포함/.exec(text)
    if (!m) continue
    if (has((r) => r.kind === 'INCLUDES' && r.item === it.id && r.varKey === 'nodes')) continue
    out.push({ kind: 'INCLUDES', item: it.id, varKey: 'nodes', qty: Number(m[1]) })
    added++
  }
  const editions = out.filter((r): r is Extract<PriceRule, { kind: 'ONE_OF' }> => r.kind === 'ONE_OF').flatMap((r) => r.items)
  for (const ed of editions) {
    const edItem = items.find((i) => i.id === ed)
    if (!edItem) continue
    const head = edItem.name.split(/\s+/)[0]
    const build = items.find((i) => i.id !== ed && /기본\s*구축/.test(i.name) && i.name.split(/\s+/)[0] === head)
    if (!build) continue
    if (has((r) => r.kind === 'WITH' && r.item === ed && r.with.includes(build.id))) continue
    out.push({ kind: 'WITH', item: ed, with: [build.id] })
    added++
  }
  return { rules: out, added }
}
