/**
 * 견적 금액 계산 (SSOT)
 *
 * **왜 순수 함수로 떼어 놓나**: 금액은 조용히 틀리면 아무도 모른다.
 * 화면이 계산하고 서버가 또 계산하면 두 숫자가 언젠가 갈리고,
 * 그때 고객에게 나간 문서와 우리 파이프라인 합계가 서로를 반박한다.
 * 그래서 계산은 **여기 한 곳**에만 있고, 화면도 서버도 이 함수를 부른다.
 *
 * **왜 정수(BigInt)인가**: 부동소수로 더하면 합계가 1원씩 어긋난다.
 * 금액은 전부 minor 단위 정수로 다루고(KRW 는 minor 가 곧 원),
 * 비율(수량·할인율·세율)만 소수로 받아 **마지막에 한 번** 반올림한다.
 */

import { toMinor, mulQty, pctOfMinor } from './money.ts'

/** 소수를 다루는 값은 문자열·숫자로 섞여 들어온다(Prisma Decimal). 한 곳에서 받는다 */
export type Numeric = number | string

/** 견적 한 줄의 입력. 여기 없는 것은 계산에 쓰지 않는다 */
export interface QuoteLineInput {
  quantity: Numeric
  unitPriceMinor: bigint | number | string
  /** 항목 할인율(%) 0~100 */
  discountPercent?: Numeric
  /** 부가세율(%) 0~100 */
  taxRate?: Numeric
}

export interface QuoteLineAmounts {
  /** 할인 전 금액 = 수량 × 단가 */
  grossMinor: bigint
  /** 할인액 */
  discountMinor: bigint
  /** 할인 후 금액 — 이것이 그 줄의 합계다(세금 제외) */
  lineTotalMinor: bigint
  /** 그 줄의 세액 */
  taxMinor: bigint
}

export interface QuoteTotals {
  subtotalMinor: bigint
  discountMinor: bigint
  taxMinor: bigint
  /** 최종 청구액 = 소계 − 할인 + 세금 */
  totalMinor: bigint
}

function num(v: Numeric | bigint | undefined | null, fallback = 0): number {
  if (v === undefined || v === null) return fallback
  const n = typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 0~100 으로 접는다. 범위 밖 값이 계산에 흘러들면 음수 금액이 나온다 */
function pct(v: Numeric | undefined | null): number {
  const n = num(v, 0)
  if (n < 0) return 0
  if (n > 100) return 100
  return n
}

/**
 * 한 줄의 금액.
 *
 * 순서가 중요하다: **수량을 먼저 곱하고, 그 다음에 할인**한다.
 * 반대로 하면(단가에 할인 → 수량 곱) 반올림 오차가 수량만큼 증폭된다.
 */
export function computeLine(line: QuoteLineInput): QuoteLineAmounts {
  const qty = Math.max(0, num(line.quantity, 0))
  const unit = toMinor(line.unitPriceMinor)

  const gross = mulQty(unit, qty)
  const discount = pctOfMinor(gross, pct(line.discountPercent))

  const lineTotal = gross - discount
  const tax = pctOfMinor(lineTotal, pct(line.taxRate))

  return { grossMinor: gross, discountMinor: discount, lineTotalMinor: lineTotal, taxMinor: tax }
}

/**
 * 견적 전체 합계.
 *
 * 줄마다 계산한 것을 더한다 — 전체를 한 번에 계산하지 않는다.
 * 화면이 보여 주는 줄 합계를 더한 값과 총액이 달라지면 사람은 둘 다 못 믿는다.
 */
export function computeTotals(lines: readonly QuoteLineInput[]): QuoteTotals {
  let subtotal = BigInt(0)
  let discount = BigInt(0)
  let tax = BigInt(0)

  for (const line of lines) {
    const a = computeLine(line)
    subtotal += a.grossMinor
    discount += a.discountMinor
    tax += a.taxMinor
  }

  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    taxMinor: tax,
    totalMinor: subtotal - discount + tax,
  }
}

/**
 * 전체 할인율(%) — 승인이 필요한지 판정하는 근거.
 * 소계가 0이면 비율을 낼 수 없다(0으로 나누지 않는다). 그때는 0으로 본다.
 */
export function discountRateOf(totals: Pick<QuoteTotals, 'subtotalMinor' | 'discountMinor'>): number {
  const sub = Number(totals.subtotalMinor)
  if (!Number.isFinite(sub) || sub <= 0) return 0
  return (Number(totals.discountMinor) / sub) * 100
}

/**
 * 할인 승인 임계 — 이 비율을 넘으면 승인 없이는 **보낼 수 없다**.
 *
 * 왜 15%인가: 근거 있는 숫자가 아니라 **바꿀 수 있게 만든 기본값**이다.
 * 워크스페이스 설정(crm.quote.discountApprovalPct)이 있으면 그것이 이긴다.
 */
export const DEFAULT_DISCOUNT_APPROVAL_PCT = 15

/** 승인이 필요한가. 판정을 화면과 서버가 따로 하면 한쪽만 막힌다 */
export function needsApproval(
  totals: Pick<QuoteTotals, 'subtotalMinor' | 'discountMinor'>,
  thresholdPct: number = DEFAULT_DISCOUNT_APPROVAL_PCT,
): boolean {
  const th = Number.isFinite(thresholdPct) && thresholdPct >= 0 ? thresholdPct : DEFAULT_DISCOUNT_APPROVAL_PCT
  return discountRateOf(totals) > th
}

/**
 * 견적 번호. 사람이 전화로 부를 수 있어야 하므로 짧고 규칙적이다.
 * `Q-2026-0007` — 연도가 바뀌면 번호도 1부터 다시 센다.
 */
export function formatQuoteNo(year: number, seq: number): string {
  const y = Number.isFinite(year) ? Math.trunc(year) : 0
  const n = Number.isFinite(seq) && seq > 0 ? Math.trunc(seq) : 1
  return `Q-${String(y).padStart(4, '0')}-${String(n).padStart(4, '0')}`
}

/** 기존 번호에서 순번을 되읽는다. 못 읽으면 0 — 다음 번호가 1이 된다 */
export function seqOfQuoteNo(quoteNo: string | null | undefined, year: number): number {
  if (!quoteNo) return 0
  const m = /^Q-(\d{4})-(\d+)$/.exec(quoteNo.trim())
  if (!m) return 0
  if (Number(m[1]) !== year) return 0
  return Number(m[2])
}

/**
 * 유효기간이 지났는지 — **읽는 시점에 판정한다.**
 * 배치로 상태를 바꾸면 배치가 실패한 날 만료된 견적이 유효한 것처럼 보인다.
 */
export function isExpired(validUntil: Date | string | null | undefined, now: Date): boolean {
  if (!validUntil) return false
  const t = validUntil instanceof Date ? validUntil.getTime() : Date.parse(String(validUntil))
  if (!Number.isFinite(t)) return false
  return t < now.getTime()
}
