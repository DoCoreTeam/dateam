/**
 * `rule` 판단기 — **진입 조건의 기본 방향** (명세 §7.2)
 *
 * 가장 단순한 판단기다. 조건이 준 방향을 그대로 쓰고, 확신은 조건이 얼마나
 * 세게 걸렸는지로 정한다. 이것이 기준선이다 — `jev` 가 이보다 나은지를
 * 같은 시점·같은 보정·같은 평가로 잰다.
 *
 * **여기서 신호를 내지 않는다.** 원점수만 만든다(M3). 보정과 기대값은 1-B 것이고,
 * 보정 없이 낸 신호는 확률이 아니라 그냥 숫자다.
 */

import type { Judge, JudgeInput, JudgeResult, RawScore } from './types.ts'

/**
 * 조건이 얼마나 세게 걸렸나를 0~1 로.
 *
 * ATR 로 나누는 이유: 가격 수준(1,050~1,130pt)이나 변동성이 달라도 같은 척도가 되게.
 * 포인트 차이를 그대로 쓰면 변동성이 큰 날에만 확신이 높게 나온다.
 */
export function strengthOf(distance: number, atrValue: number): number {
  if (!(atrValue > 0)) return 0
  const normalized = distance / atrValue
  // 1 ATR 을 넘어선 돌파는 더 세다고 보지 않는다 — 꼬리에서 확신이 1 에 붙어 버린다
  return Math.max(0, Math.min(1, normalized))
}

/**
 * 조건 세기를 방향 확률로.
 *
 * 0.5 에서 시작해 세기만큼 한쪽으로 기운다. 최대 0.8 까지만 간다 —
 * 규칙 판단기가 0.95 를 말하면 그것은 확률이 아니라 자신감이고,
 * 보정 전 값이 그렇게 크면 1-B 의 보정 곡선이 꼬리에서 표본을 못 얻는다.
 */
export function scoreFrom(direction: 'long' | 'short', strength: number): RawScore {
  const lean = 0.3 * strength
  const directional = 0.5 + lean
  const other = 0.5 - lean
  return direction === 'long'
    ? { p_long: directional, p_short: other * 0.5, p_hold: other * 0.5, enter_now: strength }
    : { p_long: other * 0.5, p_short: directional, p_hold: other * 0.5, enter_now: strength }
}

export const RULE_SPEC = 'rule-v1'

export function createRuleJudge(): Judge {
  return {
    name: 'rule',
    modelVersion: RULE_SPEC,
    async judge(input: JudgeInput): Promise<JudgeResult> {
      const last = input.bars[input.bars.length - 1]
      if (!last) return { status: 'abstain', abstainReason: 'no_bar' }
      if (!(input.indicators.atr > 0)) {
        // ATR 이 0 이면 세기를 잴 자가 없다. 0 으로 때우면 모든 조건이 세기 0 이 된다
        return { status: 'abstain', abstainReason: 'atr_zero' }
      }

      const distance = input.trigger.direction === 'long'
        ? last.close - input.indicators.recentHigh
        : input.indicators.recentLow - last.close

      /**
       * 교차 조건은 돌파 거리라는 것이 없다. 그때는 이동평균이 벌어진 정도를 쓴다 —
       * 0 으로 두면 교차로 들어온 판단은 전부 세기 0 이 되어 표본이 한쪽으로 쏠린다.
       */
      const effective = input.trigger.id.startsWith('sma_cross')
        ? Math.abs(input.indicators.smaFast - input.indicators.smaSlow)
        : distance

      return {
        status: 'completed',
        rawScore: scoreFrom(input.trigger.direction, strengthOf(effective, input.indicators.atr)),
      }
    },
  }
}
