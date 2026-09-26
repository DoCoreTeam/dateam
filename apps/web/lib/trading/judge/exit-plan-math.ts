/**
 * 청산 계획 — **실시간과 백테스트가 같은 식을 쓴다** (명세 §8 · M4)
 *
 * ## 왜 여기로 옮겼나
 *
 * 같은 식이 두 군데에 있었다. 실시간은 `jobs/emit-signal.ts` 안에서 손절·목표를 직접
 * 계산했고, 백테스트는 `backtest/run.ts` 의 `buildExitPlan` 을 썼다. 사본이 둘이면
 * 고칠 때 한쪽만 고치는 날이 오고, 그날부터 백테스트는 **실제로 안 도는 전략**의
 * 성적을 말한다. 사본을 세는 가드(`policy/trading-backtest-parity.test.ts`)는 있었지만
 * 세는 목록에 이 함수가 없어서 못 봤다.
 *
 * ## 기준가는 확정 봉 종가다
 *
 * 백테스트는 신호가 난 봉의 종가를 기준가로 쓴다(§13.1 「신호 시점 가격」). 실시간은
 * 단기 이동평균을 넘기고 있었다 — 최근 다섯 봉의 평균이라 **돌파로 걸린 신호에서는
 * 실제 가격과 크게 벌어진다.** 같은 전략을 두 가격으로 재고 있었던 것이다.
 */

import { worstEntryPrice } from '../risk/arithmetic.ts'

export interface ExitPlanParams {
  /** 손절 = 기준가 ∓ 이 배수 × ATR (§8) */
  stopAtrMultiple: number
  /** 목표 = 기준가 ± 이 배수 × ATR */
  targetAtrMultiple: number
  /** 진입 한계 = 기준가 ± 이 배수 × ATR */
  chaseAtrMultiple: number
  timeExitMinutes: number
}

export interface ExitPlanPrices {
  /** 손절가 */
  stopPrice: number
  /** 목표가 (하나다, §8) */
  targetPrice: number
  /** 진입 한계가 — 넘어서면 안 따라간다 */
  chaseLimitPrice: number
  /** 진입 후 이 분이 지나면 청산 */
  timeExitMinutes: number
  /** 당일 청산 시각 */
  sessionCloseAt: Date
}

/**
 * 청산 계획 — **방향이 부호를 정한다** (§8).
 *
 * 진입 한계가는 `worstEntryPrice` 를 지나간다. 부호 규칙을 여기서 또 쓰면
 * 숏에서 「최대 진입가」를 쓰는 D-31 버그가 다시 생긴다.
 */
export function buildExitPlan(
  direction: 'long' | 'short',
  referencePrice: number,
  atr: number,
  params: ExitPlanParams,
  sessionCloseAt: Date,
): ExitPlanPrices {
  const sign = direction === 'long' ? 1 : -1
  return {
    stopPrice: referencePrice - sign * params.stopAtrMultiple * atr,
    targetPrice: referencePrice + sign * params.targetAtrMultiple * atr,
    chaseLimitPrice: worstEntryPrice(direction, referencePrice, params.chaseAtrMultiple * atr),
    timeExitMinutes: params.timeExitMinutes,
    sessionCloseAt,
  }
}
