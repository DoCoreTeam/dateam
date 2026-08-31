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
  /** 기본(통상) 할인율(%) 0~100 — 등급·정책에서 오는, 늘 들어가는 그 할인 */
  discountPercent?: Numeric
  /**
   * 특별 할인율(%) 0~100. **없으면 null·undefined** 다 — 0 은 「0% 할인」이라는 뜻이라 다르다.
   *
   * **기본 할인 위에 겹쳐 적용된다**(사용자 지시: 「기본 할인과 특별할인이 다 붙어야지」).
   * 순서는 기본 → 특별이고, 특별은 **기본을 적용하고 남은 금액**에 걸린다.
   *
   *   1억 → 기본 30% → 7,000만 → 특별 80% → 1,400만
   *
   * 더하지 않는 이유: 30+80 = 110% 라 금액이 음수가 된다.
   * 대체하지 않는 이유: 기본 할인은 «늘 들어가는 것»이라 특별가를 준다고 사라지지 않는다.
   */
  specialDiscountPercent?: Numeric | null
  /** 부가세율(%) 0~100 */
  taxRate?: Numeric
}

export interface QuoteLineAmounts {
  /** 할인 전 금액 = 수량 × 단가 */
  grossMinor: bigint
  /** 할인액 */
  discountMinor: bigint
  /**
   * 정가 대비 **실효 할인율(%)** — 기본과 특별이 겹친 결과다.
   * 기본 30% + 특별 80% 면 86% 다(1 − 0.7×0.2). 소수 둘째 자리까지.
   */
  appliedDiscountPct: number
  /** 특별 할인이 적용됐나 — 화면·문서가 「원래는 …」을 말할지 정하는 근거 */
  isSpecial: boolean
  /** 기본 할인만 적용했다면 얼마였을지 — 「이만큼 더 깎아 드립니다」의 근거 */
  baseLineTotalMinor: bigint
  /** 할인 후 금액 — 이것이 그 줄의 합계다(세금 제외) */
  lineTotalMinor: bigint
  /** 그 줄의 세액 */
  taxMinor: bigint
}

export interface QuoteTotals {
  subtotalMinor: bigint
  /** 항목 할인 + 절사액 — 견적서의 「할인」 한 줄이 이 값이다 */
  discountMinor: bigint
  taxMinor: bigint
  /** 최종 청구액 = 소계 − 할인 + 세금 */
  totalMinor: bigint
  /** 절사로 깎인 금액. 0 이면 절사 안 함 */
  roundingMinor: bigint
}

/** 절사 방식 셋. 늘리지 않는다 — 「대충 깎기」는 규칙이 아니다 */
export type RoundingMode = 'DOWN' | 'NEAREST' | 'UP'

/** 쓸 수 있는 절사 단위(원). DB CHECK 와 같은 목록이다 */
export const ROUNDING_UNITS = [0, 1000, 10000, 100000, 1000000] as const
export type RoundingUnit = typeof ROUNDING_UNITS[number]

export interface RoundingInput {
  /** 0 이면 절사하지 않는다 */
  unit?: number | null
  mode?: RoundingMode | string | null
}

/**
 * 절사 — **금액을 단위에 맞춰 떨어뜨린다.**
 *
 * 협상 막바지에 「345,437,000원 말고 345,400,000원으로」가 반드시 나온다.
 * 그때 **단가를 손으로 조작해 맞추면** 나중에 그 단가를 아무도 설명할 수 없고
 * 원가 대비 마진도 거짓이 된다. 그래서 단가는 그대로 두고 절사액을 따로 남긴다.
 *
 * 기본이 버림인 이유: 고객에게 유리한 쪽이 협상에서 기본값이다.
 * 음수가 되지 않게 조인다 — 올림으로 총액이 늘어나는 것은 허용하지만
 * 버림으로 0 밑으로 내려가지는 않는다.
 */
export function roundAmount(amountMinor: bigint, input: RoundingInput): bigint {
  const unit = Math.trunc(Number(input.unit ?? 0))
  if (!Number.isFinite(unit) || unit <= 1) return amountMinor
  if (amountMinor <= BigInt(0)) return amountMinor

  const u = BigInt(unit)
  const rest = amountMinor % u
  if (rest === BigInt(0)) return amountMinor

  const mode = (input.mode ?? 'DOWN') as RoundingMode
  if (mode === 'UP') return amountMinor - rest + u
  if (mode === 'NEAREST') {
    return rest * BigInt(2) >= u ? amountMinor - rest + u : amountMinor - rest
  }
  return amountMinor - rest
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

  /*
    **두 할인이 겹친다.** 기본을 먼저 적용하고, 특별은 그 남은 금액에 건다.
    금액을 두 번 깎지 않고 «남은 금액»에 한 번 더 거는 이유: 반올림이 두 번 일어나면
    합계가 1원씩 어긋난다. 그래서 **최종 금액을 먼저 구하고 할인액은 그 차이**로 낸다.
  */
  const basePct = pct(line.discountPercent)
  const isSpecial = line.specialDiscountPercent !== undefined && line.specialDiscountPercent !== null
    && String(line.specialDiscountPercent).trim() !== ''
  const specialPct = isSpecial ? pct(line.specialDiscountPercent) : 0

  const afterBase = gross - pctOfMinor(gross, basePct)
  const lineTotal = isSpecial ? afterBase - pctOfMinor(afterBase, specialPct) : afterBase
  const discount = gross - lineTotal
  // 정가 대비 실효 할인율 — 화면·문서가 「몇 % 깎였나」를 말할 때 쓰는 숫자
  const appliedPct = gross === BigInt(0)
    ? 0
    : Math.round(Number(discount) / Number(gross) * 10000) / 100
  const tax = pctOfMinor(lineTotal, pct(line.taxRate))

  return {
    grossMinor: gross,
    discountMinor: discount,
    lineTotalMinor: lineTotal,
    taxMinor: tax,
    appliedDiscountPct: appliedPct,
    isSpecial,
    baseLineTotalMinor: afterBase,
  }
}

/**
 * 견적 전체 합계.
 *
 * 줄마다 계산한 것을 더한다 — 전체를 한 번에 계산하지 않는다.
 * 화면이 보여 주는 줄 합계를 더한 값과 총액이 달라지면 사람은 둘 다 못 믿는다.
 */
export function computeTotals(
  lines: readonly QuoteLineInput[],
  /*
    절사는 **항목 할인을 다 적용한 뒤** 마지막에 한 번 건다.
    줄마다 절사하면 합계가 단위에 안 맞는다(각 줄이 조금씩 남는다).
  */
  rounding: RoundingInput = {},
): QuoteTotals {
  let subtotal = BigInt(0)
  let discount = BigInt(0)
  let tax = BigInt(0)

  for (const line of lines) {
    const a = computeLine(line)
    subtotal += a.grossMinor
    discount += a.discountMinor
    tax += a.taxMinor
  }

  /*
    절사는 **공급가액(할인 후)** 에 건다. 세금은 절사된 금액으로 다시 계산한다 —
    안 그러면 「소계 − 할인 + 세금 = 총액」이 어긋나 불변식 I5 가 깨진다.

    세율이 줄마다 다를 수 있으므로 **비례로 줄인다**. 절사액이 소계의 0.1% 수준이라
    이 근사가 만드는 오차는 1원 미만이고, 그 1원은 마지막 정수 연산에서 흡수된다.
  */
  const net = subtotal - discount
  const rounded = roundAmount(net, rounding)
  const roundingMinor = net - rounded

  if (roundingMinor === BigInt(0)) {
    return {
      subtotalMinor: subtotal,
      discountMinor: discount,
      taxMinor: tax,
      totalMinor: subtotal - discount + tax,
      roundingMinor: BigInt(0),
    }
  }

  const taxAfter = net === BigInt(0) ? BigInt(0) : (tax * rounded) / net
  return {
    subtotalMinor: subtotal,
    // 절사도 할인이다 — 견적서의 「할인」 한 줄에 함께 실린다
    discountMinor: discount + roundingMinor,
    taxMinor: taxAfter,
    totalMinor: rounded + taxAfter,
    roundingMinor,
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
