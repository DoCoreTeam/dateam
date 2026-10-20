/**
 * 편집 초안의 금액 — 서버 저장과 같은 priceQuote 로 센다 (순수 함수)
 *
 * 예전에는 화면이 computeTotals 를 따로 불러, 매년 청구나 비율 줄이 생기면 화면 합계와 저장 합계가 갈렸을 것이다
 * (미리보기 1,506원 · 견적서 1,369원 사고와 같은 모양). 이제 둘 다 priceQuote 한 함수다.
 */

import { computeLine, type QuoteLineAmounts, type QuoteLineInput, type QuoteTotals, type RoundingMode } from '@/lib/crm/domain/quote-math'
import { priceQuote, type PricingResult } from '@/lib/crm/services/quote-pricing'
import { DEFAULT_DISCOUNT_APPROVAL_PCT } from '@/lib/crm/domain/quote-math'
import type { QuoteDraft, QuoteLineDraft } from '../quote-draft-shape'

export interface PricedDraft {
  totals: QuoteTotals
  approvalRequired: boolean
  lineTotals: bigint[] | null
  annualMinor: bigint
  sectionRoundingMinor: bigint
}

function asPricingLine(l: QuoteLineDraft) {
  return {
    quantity: l.quantity || 1,
    unitPriceMinor: l.unitPriceMinor || 0,
    discountPercent: l.discountPercent || 0,
    specialDiscountPercent: l.specialDiscountPercent?.trim() ? l.specialDiscountPercent : null,
    taxRate: l.taxRate || 0,
    durationValue: l.durationValue || null,
    durationUnit: l.durationUnit || null,
    kind: l.kind ?? 'QUANTITY',
    sectionIndex: typeof l.sectionIndex === 'number' ? l.sectionIndex : null,
    listPriceMinor: l.listPriceMinor ?? null,
    priceSource: l.priceSource ?? null,
    billing: l.billing ?? null,
    ratioPct: l.ratioPct ?? null,
    ratioOfSectionName: l.ratioOfSectionName ?? null,
  }
}

export function priceDraft(draft: QuoteDraft): PricedDraft {
  const lines = draft.lines.map(asPricingLine)
  const sections = draft.sections.map((s) => ({ name: s.name, roundingUnit: s.roundingUnit ?? 0 }))
  const hpm = draft.rateHoursPerMonth ? Number(draft.rateHoursPerMonth) : null
  let r: PricingResult
  try {
    r = priceQuote(lines, sections, { unit: draft.roundingUnit, mode: draft.roundingMode as RoundingMode }, DEFAULT_DISCOUNT_APPROVAL_PCT, hpm)
  } catch {
    // 비율 대상 묶음이 아직 없을 때(편집 중) — 0 으로 두고 저장 때 서버가 사람이 읽을 말로 막는다
    r = { lineTotals: null, subtotalMinor: BigInt(0), discountMinor: BigInt(0), taxMinor: BigInt(0), totalMinor: BigInt(0), roundingMinor: BigInt(0), sectionRoundingMinor: BigInt(0), annualMinor: BigInt(0), approvalRequired: false, composed: true }
  }
  return {
    totals: {
      subtotalMinor: r.subtotalMinor,
      discountMinor: r.discountMinor + r.sectionRoundingMinor,
      taxMinor: r.taxMinor,
      netTotalMinor: r.totalMinor + r.roundingMinor,
      totalMinor: r.totalMinor,
      roundingMinor: r.roundingMinor,
    },
    approvalRequired: r.approvalRequired,
    lineTotals: r.lineTotals,
    annualMinor: r.annualMinor,
    sectionRoundingMinor: r.sectionRoundingMinor,
  }
}

/** 줄 하나의 금액 — 비율 줄은 priceQuote 가 정한 합계를 쓴다(단가가 0 이라 computeLine 으로는 0) */
export function lineAmountsOf(p: PricedDraft, i: number, input: QuoteLineInput): QuoteLineAmounts {
  const a = computeLine(input)
  const t = p.lineTotals?.[i]
  if (t === undefined || t === a.lineTotalMinor) return a
  return { ...a, grossMinor: t, lineTotalMinor: t, baseLineTotalMinor: t, discountMinor: BigInt(0) }
}

/**
 * 사람이 단가를 손으로 고치면 그 칸을 잠근다 — 「사람이 고침」, 다시 채우기가 덮지 않는다.
 * 품목을 고르거나 채우기가 넣는 값은 출처를 함께 실어 오므로 잠그지 않는다.
 */
export function lockIfHuman(line: QuoteLineDraft, patch: Partial<QuoteLineDraft>): QuoteLineDraft {
  const next = { ...line, ...patch }
  const manualPrice = patch.unitPriceMinor !== undefined && patch.provenance === undefined && line.priceSource
  // 글에서 나온 줄은 수량과 할인도 잠근다 — 글을 다시 정리해도 사람이 고친 수가 남게
  const fromText = typeof (line.provenance as { textKey?: unknown } | null)?.textKey === 'string'
  const manualQty = fromText && patch.quantity !== undefined && patch.provenance === undefined
  const manualDisc = fromText && patch.discountPercent !== undefined && patch.provenance === undefined
  if (!manualPrice && !manualQty && !manualDisc) return next
  const locked = new Set(line.lockedFields ?? [])
  if (manualQty) locked.add('quantity')
  if (manualDisc) locked.add('discount')
  if (!manualPrice) return { ...next, lockedFields: [...locked] }
  locked.add('unitPrice')
  const prov = { ...(line.provenance ?? {}), unitPrice: { source: 'HUMAN', note: null } }
  return { ...next, lockedFields: [...locked], provenance: prov }
}
