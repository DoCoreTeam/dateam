/**
 * 견적 저장의 금액 판정 한 곳 — 옛 길과 새 길을 가른다 (순수 함수)
 *
 * **새 칸을 하나도 안 쓴 견적은 예전 계산 그대로다**(computeTotals, needsApproval).
 * 지난 견적은 전부 그렇다 — 열어도 저장해도 숫자가 하나도 안 바뀐다.
 *
 * 새 칸(그날 정상가, 가격 기준, 매년 청구, 비율 항목, 묶음 절사)이 하나라도 있으면 새 길이다.
 *   · 합계는 composeQuote 가 센다(묶음 절사 → 비율 → 1회와 매년)
 *   · 견적의 합계 칸(subtotal discount tax total)은 **1회분**이다. 매년분은 annualMinor 에 따로
 *   · 할인 승인은 정상가 대비로 잰다 — 단가를 깎든 할인을 넣든 예산을 맞추든 다 걸린다
 */

import { computeTotals, needsApproval, type QuoteLineInput, type RoundingInput } from '../domain/quote-math.ts'
import { composeQuote, type ComposeLine } from '../domain/quote-compose.ts'
import { needsApprovalVsList } from '../domain/pricebook/list-approval.ts'
import { LINE_KIND_PRICE_BASIS, type QuoteLineKind } from '../../terms/cost.ts'

/** 저장 직전의 줄 — toLineData 가 낸 모양에서 계산에 쓰는 칸만 */
export interface PricingLine {
  quantity: number | string
  unitPriceMinor: bigint | number | string
  discountPercent?: number | string | null
  specialDiscountPercent?: number | string | null
  taxRate?: number | string | null
  durationValue?: string | number | null
  durationUnit?: string | null
  kind?: string | null
  sectionIndex?: number | null
  listPriceMinor?: bigint | number | string | null
  priceSource?: string | null
  billing?: string | null
  ratioPct?: number | string | null
  ratioOfSectionName?: string | null
}

export interface PricingSection {
  name: string
  roundingUnit?: number | null
}

export interface PricingResult {
  /** 줄마다 저장할 합계 — 비율 줄은 여기서 처음 정해진다. 옛 길이면 null(toLineData 값 그대로) */
  lineTotals: bigint[] | null
  subtotalMinor: bigint
  discountMinor: bigint
  taxMinor: bigint
  totalMinor: bigint
  roundingMinor: bigint
  sectionRoundingMinor: bigint
  annualMinor: bigint
  approvalRequired: boolean
  /** 새 길을 탔나 — 시험과 감사가 본다 */
  composed: boolean
}

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== ''

export function usesNewPricing(lines: readonly PricingLine[], sections: readonly PricingSection[]): boolean {
  return lines.some((l) => has(l.priceSource) || l.billing === 'ANNUAL' || has(l.ratioPct) || has(l.listPriceMinor))
    || sections.some((s) => Number(s.roundingUnit ?? 0) > 1)
}

function basisOf(kind: string | null | undefined): 'HOUR' | 'MONTH' | null {
  return LINE_KIND_PRICE_BASIS[(kind ?? 'QUANTITY') as QuoteLineKind] ?? null
}

export function priceQuote(
  lines: readonly PricingLine[],
  sections: readonly PricingSection[],
  rounding: RoundingInput,
  thresholdPct: number,
  hoursPerMonth: number | null,
): PricingResult {
  if (!usesNewPricing(lines, sections)) {
    /*
      옛 길도 **줄마다 단가 기준과 월 기준 시간을 넘긴다.** 예전 서버는 이것을 안 넘겨
      시간당 단가 줄에 「2개월」을 적으면 줄 합계(1,460시간)와 견적 합계(2)가 갈렸다. 화면은 넘기고 있었다.
      운영 데이터에 그런 줄이 0줄이라(실측 2026-10-20: 기간 적은 줄 1개, 단가 기준 없는 수량 줄) 바뀌는 견적이 없다.
      단가 기준이 없는 종류(수량 공수 라이선스 비율)는 예전과 같은 셈이다.
    */
    const t = computeTotals(lines.map((l) => ({ ...l, priceBasis: basisOf(l.kind), hoursPerMonth })) as unknown as QuoteLineInput[], rounding)
    return {
      lineTotals: null,
      subtotalMinor: t.subtotalMinor,
      discountMinor: t.discountMinor,
      taxMinor: t.taxMinor,
      totalMinor: t.totalMinor,
      roundingMinor: t.roundingMinor,
      sectionRoundingMinor: BigInt(0),
      annualMinor: BigInt(0),
      approvalRequired: needsApproval(t, thresholdPct),
      composed: false,
    }
  }

  const sectionKey = (idx: number | null | undefined) => (typeof idx === 'number' && idx >= 0 && idx < sections.length ? String(idx) : null)
  const indexOfName = (name: string | null | undefined) => {
    if (!has(name)) return null
    const i = sections.findIndex((s) => s.name.trim() === String(name).trim())
    return i >= 0 ? String(i) : null
  }
  const compose: ComposeLine[] = lines.map((l, i) => ({
    key: String(i),
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor,
    discountPercent: l.discountPercent ?? 0,
    specialDiscountPercent: l.specialDiscountPercent ?? null,
    taxRate: l.taxRate ?? 10,
    durationValue: l.durationValue ?? null,
    durationUnit: l.durationUnit ?? null,
    priceBasis: basisOf(l.kind),
    hoursPerMonth,
    sectionKey: sectionKey(l.sectionIndex),
    billing: l.billing === 'ANNUAL' ? 'ANNUAL' : 'ONCE',
    ratioPct: has(l.ratioPct) ? Number(l.ratioPct) : null,
    ratioOfSectionKey: has(l.ratioPct) ? indexOfName(l.ratioOfSectionName) : null,
  }))
  const q = composeQuote(compose, sections.map((s, i) => ({ key: String(i), roundingUnit: s.roundingUnit ?? 0 })), rounding)
  const onceLines = compose
    .map((c, i) => ({ c, l: lines[i] }))
    .filter(({ c }) => c.billing !== 'ANNUAL' && c.ratioPct === null)
    .map(({ c, l }) => ({ ...c, listPriceMinor: has(l.listPriceMinor) ? String(l.listPriceMinor) : null }))
  return {
    lineTotals: q.lines.map((x) => x.amounts.lineTotalMinor),
    subtotalMinor: q.once.subtotalMinor,
    discountMinor: q.once.discountMinor,
    taxMinor: q.once.taxMinor,
    totalMinor: q.once.totalMinor,
    roundingMinor: q.once.roundingMinor,
    sectionRoundingMinor: q.once.sectionRoundingMinor,
    annualMinor: q.annual.supplyMinor,
    approvalRequired: needsApprovalVsList(onceLines, thresholdPct, q.once.sectionRoundingMinor),
    composed: true,
  }
}
