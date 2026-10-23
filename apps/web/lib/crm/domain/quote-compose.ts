/**
 * 견적 전체 계산 — 묶음 절사, 비율 항목, 1회와 매년을 가른다
 *
 * **왜 quote-math 옆에 따로 두나**: 지난 견적은 비율 항목도 묶음 절사도 매년 청구도 없다.
 * 그 견적이 지나는 길(`computeTotals`)은 한 줄도 바꾸지 않고, 새 칸을 쓰는 견적만 여기를 지난다.
 * 새 칸이 하나도 없으면 이 함수는 `computeTotals` 와 같은 숫자를 낸다(시험이 잠근다).
 *
 * 계산 순서는 이 파일 한 곳에만 있다.
 *   수량 × 단가 → 항목 할인 → 묶음 소계 → 묶음 절사 → 비율 항목 → 공급가액 → 공급가 절사 → 부가세 → 합계 절사
 *
 * 공급가 절사(P0157)는 가격표의 「할인 적용 후 만원 미만 절사」다. 1회분 공급가액에만 걸고, 깎인 금액은
 * 묶음 절사 합(sectionRoundingMinor)에 함께 넣는다. 그래야 할인 승인, 딜 금액, 견적서가 따로 배우지 않고 같이 센다.
 *
 * 화면과 서버가 따로 계산하던 때 미리보기 1,506원, 견적서 1,369원이 나왔다. 그래서 순서를 한 곳에 둔다.
 */

import { computeLine, roundAmount, type QuoteLineInput, type QuoteLineAmounts, type RoundingInput } from './quote-math.ts'
import { pctOfMinor, toMinor } from './money.ts'

/** 청구 — 1회 또는 매년. 비면 1회다(지난 견적 전부) */
export type Billing = 'ONCE' | 'ANNUAL'

export interface ComposeLine extends QuoteLineInput {
  /** 이 줄을 부르는 이름. 비율 항목이 대상 줄을 이 값으로 가리킨다 */
  key: string
  /** 어느 묶음인가. 비면 묶이지 않은 줄 */
  sectionKey?: string | null
  billing?: Billing | null
  /** 비율 항목이면 몇 % 인가. 값이 있으면 단가와 수량은 쓰지 않는다 */
  ratioPct?: number | string | null
  /** 비율의 대상 — 묶음 하나 또는 줄 하나. 둘 다 있으면 묶음이 먼저다 */
  ratioOfSectionKey?: string | null
  ratioOfLineKey?: string | null
}

export interface ComposeSection {
  key: string
  /** 묶음 절사 단위(원). 0 이면 안 함. 버림만 쓴다 — 가격표가 「만원 미만 절사」다 */
  roundingUnit?: number | null
}

/** 공급가 절사 단위 — DB CHECK(마이그 317)와 같은 목록. 0 은 안 함 */
export const SUPPLY_ROUNDING_UNITS = [0, 1000, 10000, 100000, 1000000] as const

export function isSupplyRoundingUnit(v: unknown): v is typeof SUPPLY_ROUNDING_UNITS[number] {
  return (SUPPLY_ROUNDING_UNITS as readonly number[]).includes(Number(v)) && v !== null && v !== ''
}

/** 합계 절사와 공급가 절사. supplyUnit 은 0 이면 안 함, 버림만 쓴다 */
export interface ComposeRounding extends RoundingInput {
  supplyUnit?: number | null
}

export interface ComposedLine {
  key: string
  amounts: QuoteLineAmounts
  /** 비율 항목이면 그 대상 금액. 화면이 「74,000,000 × 15%」를 적는 근거 */
  ratioBaseMinor: bigint | null
}

export interface ComposedSection {
  key: string
  billing: Billing
  /** 절사 전 소계(할인 뒤, 세금 제외) */
  subtotalMinor: bigint
  roundingMinor: bigint
  /** 절사 뒤 금액 — 이 묶음의 계약 금액 */
  totalMinor: bigint
}

export interface ComposedTotals {
  subtotalMinor: bigint
  discountMinor: bigint
  /** 묶음 절사로 깎인 합. 공급가 절사도 여기에 들어 있다 */
  sectionRoundingMinor: bigint
  /** 그 가운데 공급가 절사로 깎인 몫 (화면이 따로 적는 근거) */
  supplyRoundingMinor: bigint
  taxMinor: bigint
  netTotalMinor: bigint
  totalMinor: bigint
  roundingMinor: bigint
}

export interface ComposedQuote {
  lines: ComposedLine[]
  sections: ComposedSection[]
  /** 1회분. 견적서 합계, 딜 금액, 리포트가 이 값을 쓴다 */
  once: ComposedTotals
  /** 매년분. 합계에 섞지 않는다 — 섞으면 매출이 그만큼 부푼다 */
  annual: { supplyMinor: bigint; taxMinor: bigint; totalMinor: bigint }
}

export class ComposeError extends Error {
  readonly code: 'RATIO_CYCLE' | 'RATIO_TARGET_MISSING'
  constructor(code: 'RATIO_CYCLE' | 'RATIO_TARGET_MISSING', message: string) {
    super(message)
    this.code = code
  }
}

const ZERO = BigInt(0)

function isRatio(l: ComposeLine): boolean {
  return l.ratioPct !== null && l.ratioPct !== undefined && String(l.ratioPct).trim() !== ''
}

function billingOf(l: ComposeLine): Billing {
  return l.billing === 'ANNUAL' ? 'ANNUAL' : 'ONCE'
}

/**
 * 비율 항목을 어떤 순서로 셀지 — 대상이 먼저 끝나 있어야 한다.
 * 비율이 서로를 가리켜 돌면 셀 수 없으므로 던진다(저장 전 검사가 먼저 막는다).
 */
function ratioOrder(lines: readonly ComposeLine[]): ComposeLine[] {
  const ratios = lines.filter(isRatio)
  const done = new Set<string>()
  const ordered: ComposeLine[] = []
  const sectionOf = new Map(lines.map((l) => [l.key, l.sectionKey ?? null]))
  let guard = ratios.length + 1
  while (ordered.length < ratios.length && guard-- > 0) {
    for (const r of ratios) {
      if (done.has(r.key)) continue
      if (r.ratioOfSectionKey) {
        const blocked = ratios.some((o) => o.key !== r.key && !done.has(o.key) && (o.sectionKey ?? null) === r.ratioOfSectionKey)
        if (blocked) continue
      } else if (r.ratioOfLineKey) {
        if (!sectionOf.has(r.ratioOfLineKey)) {
          throw new ComposeError('RATIO_TARGET_MISSING', `비율 항목 ${r.key} 의 대상 줄이 없습니다`)
        }
        const target = ratios.find((o) => o.key === r.ratioOfLineKey)
        if (target && !done.has(target.key)) continue
      } else {
        throw new ComposeError('RATIO_TARGET_MISSING', `비율 항목 ${r.key} 의 대상이 없습니다`)
      }
      done.add(r.key)
      ordered.push(r)
    }
  }
  if (ordered.length < ratios.length) throw new ComposeError('RATIO_CYCLE', '비율 항목이 서로를 가리킵니다')
  return ordered
}

function sectionRounding(subtotal: bigint, unit: number | null | undefined): bigint {
  const u = Math.trunc(Number(unit ?? 0))
  if (!Number.isFinite(u) || u <= 1) return ZERO
  return subtotal - roundAmount(subtotal, { unit: u, mode: 'DOWN' })
}

/**
 * 견적 전체를 센다. 순서는 파일 머리의 그대로다.
 */
export function composeQuote(
  lines: readonly ComposeLine[],
  sections: readonly ComposeSection[] = [],
  rounding: ComposeRounding = {},
): ComposedQuote {
  const unitOf = new Map(sections.map((s) => [s.key, s.roundingUnit ?? 0]))
  const amounts = new Map<string, QuoteLineAmounts>()
  const ratioBase = new Map<string, bigint>()

  for (const l of lines) {
    if (!isRatio(l)) amounts.set(l.key, computeLine(l))
  }

  // 묶음 소계와 절사 — 비율 항목이 든 묶음은 그 비율을 다 센 뒤에 닫는다
  const sectionKeys = [...new Set(lines.map((l) => l.sectionKey ?? null).filter((k): k is string => k !== null))]
  const closed = new Map<string, { subtotal: bigint; rounding: bigint }>()
  const closeSection = (key: string) => {
    let subtotal = ZERO
    for (const l of lines) {
      if ((l.sectionKey ?? null) !== key) continue
      const a = amounts.get(l.key)
      if (a) subtotal += a.lineTotalMinor
    }
    closed.set(key, { subtotal, rounding: sectionRounding(subtotal, unitOf.get(key)) })
  }
  const ratios = ratioOrder(lines)
  const sectionHasRatio = (key: string) => ratios.some((r) => (r.sectionKey ?? null) === key)
  for (const key of sectionKeys) if (!sectionHasRatio(key)) closeSection(key)

  for (const r of ratios) {
    let base = ZERO
    if (r.ratioOfSectionKey) {
      if (!closed.has(r.ratioOfSectionKey)) {
        if (!sectionKeys.includes(r.ratioOfSectionKey)) {
          throw new ComposeError('RATIO_TARGET_MISSING', `비율 항목 ${r.key} 의 대상 묶음이 없습니다`)
        }
        closeSection(r.ratioOfSectionKey)
      }
      const c = closed.get(r.ratioOfSectionKey)
      base = c ? c.subtotal - c.rounding : ZERO
    } else if (r.ratioOfLineKey) {
      base = amounts.get(r.ratioOfLineKey)?.lineTotalMinor ?? ZERO
    }
    ratioBase.set(r.key, base)
    // 비율 금액은 단가 자리에 서고 수량은 1 — 할인과 세금은 보통 줄과 같은 길을 지난다
    const gross = pctOfMinor(base, r.ratioPct, 'floor')
    amounts.set(r.key, computeLine({ ...r, quantity: 1, unitPriceMinor: gross, durationValue: null, durationUnit: null }))
    const s = r.sectionKey ?? null
    if (s && !ratios.some((o) => !amounts.has(o.key) && (o.sectionKey ?? null) === s)) closeSection(s)
  }
  for (const key of sectionKeys) if (!closed.has(key)) closeSection(key)

  const composedSections: ComposedSection[] = sectionKeys.map((key) => {
    const c = closed.get(key) ?? { subtotal: ZERO, rounding: ZERO }
    const first = lines.find((l) => (l.sectionKey ?? null) === key)
    return {
      key,
      billing: first ? billingOf(first) : 'ONCE',
      subtotalMinor: c.subtotal,
      roundingMinor: c.rounding,
      totalMinor: c.subtotal - c.rounding,
    }
  })

  // 1회와 매년을 가른다. 묶음 절사의 세금은 그 묶음 첫 줄의 세율로 뺀다
  const sum = (billing: Billing) => {
    let subtotal = ZERO, discount = ZERO, tax = ZERO, secRound = ZERO
    for (const l of lines) {
      if (billingOf(l) !== billing) continue
      const a = amounts.get(l.key)
      if (!a) continue
      subtotal += a.grossMinor
      discount += a.discountMinor
      tax += a.taxMinor
    }
    for (const s of composedSections) {
      if (s.billing !== billing || s.roundingMinor === ZERO) continue
      const first = lines.find((l) => (l.sectionKey ?? null) === s.key)
      secRound += s.roundingMinor
      tax -= pctOfMinor(s.roundingMinor, first?.taxRate ?? 0)
    }
    return { subtotal, discount, tax, secRound }
  }

  const o = supplyRounded(sum('ONCE'), lines.filter((l) => billingOf(l) === 'ONCE'), rounding.supplyUnit)
  const net = o.subtotal - o.discount - o.secRound + o.tax
  const rounded = roundAmount(net, rounding)
  const a = sum('ANNUAL')
  const annualSupply = a.subtotal - a.discount - a.secRound

  return {
    lines: lines.map((l) => ({
      key: l.key,
      amounts: amounts.get(l.key) as QuoteLineAmounts,
      ratioBaseMinor: ratioBase.get(l.key) ?? null,
    })),
    sections: composedSections,
    once: {
      subtotalMinor: o.subtotal,
      discountMinor: o.discount,
      sectionRoundingMinor: o.secRound,
      supplyRoundingMinor: o.supRound,
      taxMinor: o.tax,
      netTotalMinor: net,
      totalMinor: rounded,
      roundingMinor: net - rounded,
    },
    annual: { supplyMinor: annualSupply, taxMinor: a.tax, totalMinor: annualSupply + a.tax },
  }
}

interface BillingSum { subtotal: bigint; discount: bigint; tax: bigint; secRound: bigint }

/**
 * 공급가 절사 — 할인과 묶음 절사 뒤 공급가액을 단위 아래로 버리고, 부가세는 절사 뒤 금액에서 다시 센다.
 * 줄의 세율이 하나면 「절사 뒤 공급가 × 세율」, 섞였으면 줄 세금 합에서 깎인 몫의 세금만 뺀다(첫 줄 세율).
 * 35,912,345원에 만원 절사면 35,910,000원, 깎인 2,345원은 공급가 절사이고 부가세는 3,591,000원이다.
 */
function supplyRounded(s: BillingSum, onceLines: readonly ComposeLine[], unit: number | null | undefined): BillingSum & { supRound: bigint } {
  const supply = s.subtotal - s.discount - s.secRound
  const supRound = sectionRounding(supply, unit)
  if (supRound === ZERO) return { ...s, supRound }
  const rates = [...new Set(onceLines.map((l) => Number(l.taxRate ?? 0)))]
  const tax = rates.length === 1 ? pctOfMinor(supply - supRound, rates[0]) : s.tax - pctOfMinor(supRound, rates[0] ?? 0)
  return { ...s, secRound: s.secRound + supRound, tax, supRound }
}

/**
 * 몇 년 총비용 — 초기 1회분에 매년분을 (년수 − 무상 년수) 번 더한다.
 * 가격표: 「도입 첫해 무상, 2년차부터 매년」. 5년이면 매년분 4번.
 */
export function totalCostOverYears(
  onceSupplyMinor: bigint,
  annualSupplyMinor: bigint,
  years: number,
  freeYears = 1,
): bigint {
  const paid = Math.max(0, Math.trunc(years) - Math.max(0, Math.trunc(freeYears)))
  return toMinor(onceSupplyMinor) + toMinor(annualSupplyMinor) * BigInt(paid)
}

/** 1회분 공급가액 — 소계 − 할인 − 묶음 절사 */
export function supplyOf(t: ComposedTotals): bigint {
  return t.subtotalMinor - t.discountMinor - t.sectionRoundingMinor
}
