/**
 * 거래비용 — **선물 수수료는 약정금액에 비례한다**
 *
 * ## 왜 이 파일이 생겼나
 *
 * 설정 `fee_rate` 는 이름이 「수수료율」인데 쓰이는 자리에서는 `roundTripFeeKrw`(정액 원)
 * 였다. 요율을 그대로 넣으면 왕복 수수료가 **0.00185원**이 된다 — 이름과 쓰임이 갈린
 * 자리는 언젠가 누가 이름을 믿고 값을 넣는다.
 *
 * 그리고 정액으로 두면 **지수가 움직일 때 비용이 안 따라간다.** 선물 수수료는
 * 약정금액(지수 × 승수)에 비례하므로, 지수가 오르면 같은 한 계약의 수수료도 오른다.
 *
 * ## 기본값의 근거
 *
 * 한국투자증권 공개 요율(2026-09-29 확인):
 *   · 뱅키스(제휴은행 개설) 온라인 KOSPI200·미니KOSPI200 **0.00185%** (편도, 약정금액 대비)
 *   · 영업점 계좌 KOSPI200·미니KOSPI200·KRX300 **0.009811%**
 *   · 위 요율에 **유관기관제비용은 별도**다 (거래소·예탁결제원)
 *
 * 그래서 요율은 요율대로 세고, 그 밖의 고정 비용은 `fee_rate`(원)로 더한다.
 */

export interface FeeInput {
  /** 진입 기준가 (지수) */
  referencePrice: number
  /** 1계약 승수(원). 미니 KOSPI200 은 50,000 */
  multiplier: number
  /** 계약 수 */
  quantity: number
  /** 편도 수수료율(%). 0.00185 는 0.00185% 라는 뜻이다 */
  percentPerSide: number
  /** 그 밖의 고정 비용(원, 왕복). 유관기관제비용처럼 요율로 안 잡히는 것 */
  flatKrw: number
}

/**
 * 왕복 거래비용(원).
 *
 * **들어가고 나오는 두 번**을 센다. 편도만 세면 비용이 절반으로 잡히고,
 * 건당 손익이 실제보다 좋아 보인다.
 *
 * 값이 이상하면 **0 을 돌려주지 않고 0 으로 수렴시킨다** — 음수 비용은 수익이 되므로
 * 그것만은 막는다.
 */
export function roundTripFeeKrw(input: FeeInput): number {
  const notional = input.referencePrice * input.multiplier * input.quantity
  if (!Number.isFinite(notional) || notional <= 0) return Math.max(0, input.flatKrw)
  const rate = Number.isFinite(input.percentPerSide) ? Math.max(0, input.percentPerSide) : 0
  // 요율은 퍼센트다. 0.00185 는 0.00185% 이므로 100 으로 나눈다
  const perSide = notional * (rate / 100)
  const flat = Number.isFinite(input.flatKrw) ? Math.max(0, input.flatKrw) : 0
  return perSide * 2 + flat
}

/** 거래비용이 실제로 잡혔나. 둘 다 0 이면 성적에 비용이 하나도 안 빠진 것이다 */
export function feeConfigured(percentPerSide: number, flatKrw: number): boolean {
  return (Number.isFinite(percentPerSide) && percentPerSide > 0)
    || (Number.isFinite(flatKrw) && flatKrw > 0)
}
