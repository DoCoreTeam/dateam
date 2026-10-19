/**
 * 할인 승인을 정상가 대비로 잰다
 *
 * 지금 승인은 할인 칸에 적힌 할인만 센다(`quote-math.ts` discountRateOf). 단가를 깎거나
 * 예산 맞추기로 단가를 밀면 할인 칸이 0 이라 승인이 안 걸렸다.
 * 정상가가 있는 줄은 「정상가 × 수량 × 기간」과 그 줄의 최종 금액의 차이를 할인으로 센다.
 * 그러면 단가를 깎든 할인을 넣든 예산을 맞추든, 고객에게 깎아 준 만큼이 빠짐없이 승인에 걸린다.
 * 정상가가 없는 직접 입력 줄은 지금처럼 할인 칸으로 잰다.
 */

import { computeLine, DEFAULT_DISCOUNT_APPROVAL_PCT, type QuoteLineInput } from '../quote-math.ts'
import { toMinor } from '../money.ts'

export interface ListApprovalLine extends QuoteLineInput {
  /** 그날 정상가(원). null 이면 직접 입력 줄 */
  listPriceMinor?: bigint | number | string | null
}

export interface ListDiscount {
  /** 정상가로 셌을 때 금액 */
  listGrossMinor: bigint
  /** 깎아 준 금액 — 정상가 대비 */
  discountMinor: bigint
  /** 할인율(%) */
  ratePct: number
}

export function discountVsList(lines: readonly ListApprovalLine[], sectionRoundingMinor: bigint = BigInt(0)): ListDiscount {
  let listGross = BigInt(0)
  let discount = BigInt(0)
  for (const l of lines) {
    const actual = computeLine(l)
    const hasList = l.listPriceMinor !== null && l.listPriceMinor !== undefined && String(l.listPriceMinor).trim() !== ''
    if (!hasList) {
      listGross += actual.grossMinor
      discount += actual.discountMinor
      continue
    }
    const asList = computeLine({ ...l, unitPriceMinor: toMinor(l.listPriceMinor), discountPercent: 0, specialDiscountPercent: null })
    listGross += asList.grossMinor
    const d = asList.grossMinor - actual.lineTotalMinor
    discount += d > BigInt(0) ? d : BigInt(0)
  }
  discount += sectionRoundingMinor
  const rate = listGross > BigInt(0) ? Math.round((Number(discount) / Number(listGross)) * 10_000) / 100 : 0
  return { listGrossMinor: listGross, discountMinor: discount, ratePct: rate }
}

export function needsApprovalVsList(
  lines: readonly ListApprovalLine[],
  thresholdPct: number = DEFAULT_DISCOUNT_APPROVAL_PCT,
  sectionRoundingMinor: bigint = BigInt(0),
): boolean {
  const th = Number.isFinite(thresholdPct) && thresholdPct >= 0 ? thresholdPct : DEFAULT_DISCOUNT_APPROVAL_PCT
  return discountVsList(lines, sectionRoundingMinor).ratePct > th
}
