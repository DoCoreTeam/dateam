/**
 * 편집 초안을 예산에 맞춘다 — 단가가 아니라 할인 칸으로 (순수 함수)
 *
 * 계산은 fitToBudget(가격 기준 엔진) 한 곳이다. 여기서는 초안의 줄을 그 모양으로 바꾸고
 * 결과 할인율을 초안에 되돌려 놓고 사람이 읽을 한 줄을 만든다.
 *
 * 할인할 수 있는 줄: 비율 줄과 매년 줄이 아니고, 출처에 「할인 대상 아님」이 없고, 사람이 할인 칸을 잠그지 않은 줄.
 * 제품으로 채운 구축비는 출처에 discountable=false 가 있어 빠진다. 손으로 친 줄은 할인할 수 있다고 본다.
 */

import { fitToBudget, type FitLine } from '../../../../lib/crm/domain/pricebook/budget-fit.ts'
import { BUDGET_SENTENCE } from '../../../../lib/terms/pricebook.ts'
import type { RoundingMode } from '../../../../lib/crm/domain/quote-math.ts'
import { LINE_KIND_PRICE_BASIS, type QuoteLineKind } from '../../../../lib/terms/cost.ts'
import type { QuoteDraft, QuoteLineDraft } from '../quote-draft-shape'

export interface BudgetFitOutcome {
  draft: QuoteDraft
  message: string
  changed: boolean
  /** 승인 기준을 넘어 넣지 않은 할인율 — 사람이 「할인 n% 넣기」로 넣는다 */
  neededPct: number | null
}

const won = (v: bigint) => Number(v).toLocaleString('ko-KR')

function discountableOf(l: QuoteLineDraft): boolean {
  const p = (l.provenance ?? {}) as { discountable?: unknown }
  if (p.discountable === false) return false
  if (l.ratioPct || l.billing === 'ANNUAL') return false
  return true
}

function toFitLine(l: QuoteLineDraft, i: number, hpm: number | null): FitLine {
  return {
    key: String(i),
    quantity: l.quantity || 1,
    unitPriceMinor: l.unitPriceMinor || 0,
    discountPercent: l.discountPercent || 0,
    specialDiscountPercent: l.specialDiscountPercent?.trim() ? l.specialDiscountPercent : null,
    taxRate: l.taxRate || 0,
    durationValue: l.durationValue || null,
    durationUnit: l.durationUnit || null,
    priceBasis: LINE_KIND_PRICE_BASIS[(l.kind ?? 'QUANTITY') as QuoteLineKind] ?? null,
    hoursPerMonth: hpm,
    sectionKey: typeof l.sectionIndex === 'number' ? String(l.sectionIndex) : null,
    billing: l.billing === 'ANNUAL' ? 'ANNUAL' : 'ONCE',
    ratioPct: l.ratioPct ? Number(l.ratioPct) : null,
    ratioOfSectionKey: null,
    discountable: discountableOf(l),
    locked: (l.lockedFields ?? []).includes('discount'),
  }
}

export function fitDraftToBudget(draft: QuoteDraft, budgetMinor: bigint, includesTax: boolean, opts: { allowOverCap?: boolean } = {}): BudgetFitOutcome {
  const hpm = draft.rateHoursPerMonth ? Number(draft.rateHoursPerMonth) : null
  const sectionKeyOf = (name: string | null | undefined) => {
    const i = draft.sections.findIndex((s) => s.name === name)
    return i >= 0 ? String(i) : null
  }
  const lines = draft.lines.map((l, i) => ({ ...toFitLine(l, i, hpm), ratioOfSectionKey: l.ratioPct ? sectionKeyOf(l.ratioOfSectionName) : null }))
  const sections = draft.sections.map((s, i) => ({ key: String(i), roundingUnit: s.roundingUnit ?? 0 }))
  const r = fitToBudget(lines, sections, { totalMinor: budgetMinor, includesTax }, { unit: draft.roundingUnit, mode: draft.roundingMode as RoundingMode, supplyUnit: draft.supplyRoundingUnit ?? 0 }, { allowOverCap: opts.allowOverCap })
  const base = { ...draft, budgetMinor: budgetMinor.toString(), budgetIncludesTax: includesTax }
  if (r.reason === 'ALREADY_UNDER') return { draft: base, message: BUDGET_SENTENCE.alreadyUnder(won(r.gapMinor)), changed: false, neededPct: null }
  if (r.reason === 'NO_DISCOUNTABLE') return { draft: base, message: BUDGET_SENTENCE.noDiscountable, changed: false, neededPct: null }
  const next = draft.lines.map((l, i) => {
    const fitted = r.lines[i]
    if (Number(fitted.discountPercent ?? 0) === Number(l.discountPercent || 0)) return l
    return {
      ...l,
      discountPercent: String(fitted.discountPercent),
      provenance: { ...(l.provenance ?? {}), discount: { source: 'BUDGET', note: `예산 맞추기 ${r.discountPct}%` } },
    }
  })
  const message = r.reason === 'NOT_ENOUGH'
    ? BUDGET_SENTENCE.notEnough(r.discountPct ?? 0, won(r.achievedMinor), won(-r.gapMinor))
    : r.reason === 'OVER_CAP'
      ? BUDGET_SENTENCE.overCap(r.discountPct ?? 0, won(r.achievedMinor), won(-r.gapMinor), r.neededPct ?? 0)
      : r.gapMinor === BigInt(0)
        ? BUDGET_SENTENCE.fitted(r.discountPct ?? 0, won(r.achievedMinor))
        : BUDGET_SENTENCE.fittedGap(r.discountPct ?? 0, won(r.achievedMinor), won(r.gapMinor))
  const changed = next.some((l, i) => l !== draft.lines[i])
  return { draft: { ...base, lines: next }, message, changed, neededPct: r.reason === 'OVER_CAP' ? (r.neededPct ?? null) : null }
}
