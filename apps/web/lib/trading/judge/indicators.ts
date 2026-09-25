/**
 * 지표와 진입 조건 — 순수 함수
 *
 * ## 왜 판단기 밖에서 한 번만 계산하나
 *
 * 판단기마다 자기가 계산하면 같은 시점에 서로 다른 ATR 을 볼 수 있다(기간이 한 글자만
 * 달라도). 그러면 「어느 판단기가 나은가」가 아니라 「누가 더 나은 지표를 봤나」를 재게 된다.
 *
 * ## 왜 봉만 받나
 *
 * 시계도 DB 도 안 받는다. 받으면 판단기가 미래를 볼 길이 생긴다(M5).
 * 여기 들어오는 봉은 부르는 쪽이 이미 `available_at ≤ 판단 시각`으로 걸러 온 것이다.
 */

import type { MinuteBarInput } from '../bars/confirm.ts'
import type { Indicators, TriggerHit } from './types.ts'

/**
 * ATR (Wilder). 봉이 모자라면 null — **0 으로 때우지 않는다.**
 * 0 이면 손절 거리가 0 이 되고, 그것은 「즉시 손절」이라는 뜻이 된다.
 */
export function atr(bars: readonly MinuteBarInput[], period: number): number | null {
  if (period < 1 || bars.length < period + 1) return null
  const trueRanges: number[] = []
  for (let i = bars.length - period; i < bars.length; i += 1) {
    const cur = bars[i]
    const prevClose = bars[i - 1].close
    trueRanges.push(Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    ))
  }
  return trueRanges.reduce((sum, v) => sum + v, 0) / period
}

/** 단순 이동평균. 봉이 모자라면 null */
export function sma(bars: readonly MinuteBarInput[], period: number): number | null {
  if (period < 1 || bars.length < period) return null
  const slice = bars.slice(bars.length - period)
  return slice.reduce((sum, b) => sum + b.close, 0) / period
}

/** 최근 N봉(마지막 봉 제외)의 고가·저가. 돌파는 「직전까지의 범위」를 넘는 것이다 */
export function recentRange(
  bars: readonly MinuteBarInput[],
  period: number,
): { high: number; low: number } | null {
  if (period < 1 || bars.length < period + 1) return null
  const window = bars.slice(bars.length - 1 - period, bars.length - 1)
  return {
    high: Math.max(...window.map((b) => b.high)),
    low: Math.min(...window.map((b) => b.low)),
  }
}

export interface IndicatorParams {
  atrPeriod: number
  smaFastPeriod: number
  smaSlowPeriod: number
  breakoutPeriod: number
}

/** 지표를 한 번에. 하나라도 못 구하면 null — 반쪽 지표로 판단하지 않는다 */
export function computeIndicators(
  bars: readonly MinuteBarInput[],
  params: IndicatorParams,
): Indicators | null {
  const a = atr(bars, params.atrPeriod)
  const fast = sma(bars, params.smaFastPeriod)
  const slow = sma(bars, params.smaSlowPeriod)
  const range = recentRange(bars, params.breakoutPeriod)
  if (a === null || fast === null || slow === null || range === null) return null
  return { atr: a, smaFast: fast, smaSlow: slow, recentHigh: range.high, recentLow: range.low }
}

/** 지표를 구하는 데 필요한 최소 봉 수. 부르는 쪽이 얼마나 읽어야 하는지 알아야 한다 */
export function requiredBarCount(params: IndicatorParams): number {
  return Math.max(
    params.atrPeriod + 1,
    params.smaFastPeriod,
    params.smaSlowPeriod,
    params.breakoutPeriod + 1,
  )
}

// ── 진입 조건 (§7.1) ─────────────────────────────────────

/**
 * 전략 하나에 진입 조건 둘.
 *
 * 둘로 둔 이유: 하나면 「그 조건이 안 맞는 장」에서는 표본이 아예 안 쌓이고,
 * 셋 이상이면 어느 조건이 성과를 낸 것인지 표본이 갈려 1-B 에서 못 가른다.
 * 조건마다 `id` 를 남기므로 나중에 조건별로 따로 셀 수 있다.
 */
export interface TriggerParams extends IndicatorParams {
  /** 돌파로 인정할 최소 폭 (ATR 배수). 0 이면 한 틱만 넘어도 걸린다 */
  breakoutAtrMultiple: number
}

/**
 * 지금 봉이 어떤 조건을 걸었나. 하나도 안 걸리면 null —
 * **그때는 판단기를 부르지 않는다.** 부르면 조건과 무관한 표본이 섞여 비교가 흐려지고,
 * 1-A 에서는 Jev 호출이 쓸데없이 늘어난다(예산).
 */
export function evaluateTriggers(
  bars: readonly MinuteBarInput[],
  indicators: Indicators,
  params: TriggerParams,
): TriggerHit | null {
  const last = bars[bars.length - 1]
  if (!last) return null
  const margin = indicators.atr * params.breakoutAtrMultiple

  // T1 돌파 — 직전 N봉의 범위를 ATR 배수만큼 넘어섰나
  if (last.close > indicators.recentHigh + margin) {
    return {
      id: 'breakout_up',
      direction: 'long',
      detail: `종가 ${last.close} > 최근 고가 ${indicators.recentHigh} + ${margin.toFixed(2)}`,
    }
  }
  if (last.close < indicators.recentLow - margin) {
    return {
      id: 'breakout_down',
      direction: 'short',
      detail: `종가 ${last.close} < 최근 저가 ${indicators.recentLow} - ${margin.toFixed(2)}`,
    }
  }

  // T2 이동평균 교차 — 이번 봉에서 **처음** 뒤집힌 순간만. 이미 뒤집힌 상태는 조건이 아니다
  const prevBars = bars.slice(0, bars.length - 1)
  const prevFast = sma(prevBars, params.smaFastPeriod)
  const prevSlow = sma(prevBars, params.smaSlowPeriod)
  if (prevFast !== null && prevSlow !== null) {
    if (prevFast <= prevSlow && indicators.smaFast > indicators.smaSlow) {
      return { id: 'sma_cross_up', direction: 'long', detail: `단기가 장기를 상향 교차` }
    }
    if (prevFast >= prevSlow && indicators.smaFast < indicators.smaSlow) {
      return { id: 'sma_cross_down', direction: 'short', detail: `단기가 장기를 하향 교차` }
    }
  }

  return null
}
