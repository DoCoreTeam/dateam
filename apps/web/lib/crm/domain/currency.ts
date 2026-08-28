/**
 * 통화 환산 (통합기획서 v0.2.1 259행 "다중 통화 합산: 워크스페이스 기본 통화로 환산(환율 스냅샷)")
 *
 * 규칙 하나가 전부다: **환율은 스냅샷을 쓴다.**
 * 리포트를 어제 보든 오늘 보든 같은 딜은 같은 값이어야 한다. '지금 환율'로 매번 환산하면
 * 아무도 손대지 않은 지난달 실적이 오늘 아침에 달라져 있다.
 *
 * 금액은 minor 단위 정수(BigInt)다. 부동소수를 거치지 않는다 —
 * 0.1 + 0.2 가 0.30000000000000004 인 세계에서 합계를 맞출 수 없다.
 */

/** 환율 스냅샷 한 줄 (crm_exchange_rate) */
export interface RateSnapshot {
  base: string
  quote: string
  /** 1 base = rate quote */
  rate: number
  /** 기준일 (YYYY-MM-DD) */
  date: string
}

export interface MoneyMinor {
  amountMinor: bigint
  currency: string
}

/** ISO 4217 minor unit 자릿수. 여기 없는 통화는 2로 본다(대다수가 2다). */
const MINOR_DIGITS: Record<string, number> = {
  KRW: 0, // 원은 소수가 없다 — 1원이 곧 minor
  JPY: 0,
  USD: 2,
  EUR: 2,
}

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2
}

/**
 * from 통화의 minor 금액을 to 통화의 minor 금액으로 바꾼다.
 * 환율을 찾지 못하면 **0 으로 때우지 않고 null 을 돌려준다** —
 * 못 세는 것을 0으로 세면 합계가 조용히 작아지고, 아무도 눈치채지 못한다.
 */
export function convertMinor(
  money: MoneyMinor,
  to: string,
  rates: readonly RateSnapshot[],
): bigint | null {
  const from = money.currency.toUpperCase()
  const target = to.toUpperCase()
  if (from === target) return money.amountMinor

  const rate = findRate(from, target, rates)
  if (rate === null) return null

  // minor → major → 환산 → minor. 자릿수가 다른 통화(KRW 0 ↔ USD 2)를 건너뛰지 않기 위해서다.
  const fromScale = 10 ** minorDigits(from)
  const toScale = 10 ** minorDigits(target)
  const major = Number(money.amountMinor) / fromScale
  return BigInt(Math.round(major * rate * toScale)) // minor-ok — 통화 자릿수가 달라(KRW 0 ↔ USD 2) toMinor 로는 스케일을 못 바꾼다
}

/** 직접 환율 → 역방향 환율 순으로 찾는다. 삼각 환산은 하지 않는다(오차가 조용히 쌓인다). */
export function findRate(
  from: string,
  to: string,
  rates: readonly RateSnapshot[],
): number | null {
  const direct = rates.find((r) => r.base === from && r.quote === to)
  if (direct && direct.rate > 0) return direct.rate

  const inverse = rates.find((r) => r.base === to && r.quote === from)
  if (inverse && inverse.rate > 0) return 1 / inverse.rate

  return null
}

export interface RollupResult {
  /** 환산에 성공한 것들의 합 */
  totalMinor: bigint
  currency: string
  /** 합계에 들어간 건수 */
  counted: number
  /** 환율이 없어 못 센 것 — 화면이 반드시 표시해야 한다 */
  skipped: { amountMinor: bigint; currency: string }[]
}

/**
 * 여러 통화의 금액을 기본 통화로 합산한다.
 * 못 센 것은 버리지 않고 skipped 로 돌려준다 — 화면이 "일부는 환율이 없어 빠졌다"고 말해야 한다.
 */
export function rollupToBase(
  items: readonly MoneyMinor[],
  base: string,
  rates: readonly RateSnapshot[],
): RollupResult {
  let total = BigInt(0) // tsconfig target 이 ES2020 미만이라 0n 리터럴을 쓸 수 없다
  let counted = 0
  const skipped: RollupResult['skipped'] = []

  for (const item of items) {
    const converted = convertMinor(item, base, rates)
    if (converted === null) {
      skipped.push({ amountMinor: item.amountMinor, currency: item.currency })
      continue
    }
    total += converted
    counted += 1
  }

  return { totalMinor: total, currency: base.toUpperCase(), counted, skipped }
}
