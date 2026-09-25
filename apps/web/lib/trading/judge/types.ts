/**
 * 판단기 — **셋이 같은 꼴이고 특권이 없다** (명세 §7.2)
 *
 * `rule`·`ml`·`jev` 를 같은 인터페이스로 둔다. 같은 시점·같은 보정·같은 평가로 비교해야
 * 「어느 판단기가 나은가」를 답할 수 있다. 하나에게만 더 많은 입력이나 더 이른 시점을 주면
 * 그 비교는 처음부터 기울어져 있고, 기울어진 비교로 고른 판단기는 실전에서 안 맞는다.
 *
 * 1-A 는 `rule` 과 `jev` 만 만든다(`ml` 은 1-B 의 기준선). 그래도 인터페이스는 지금 셋을
 * 받게 둔다 — 나중에 끼워 넣으면 그때 인터페이스를 고치게 되고, 고치는 순간
 * 이미 쌓인 판단 기록과 비교가 안 된다.
 */

import type { MinuteBarInput } from '../bars/confirm.ts'

export type JudgeName = 'rule' | 'ml' | 'jev'

/** 방향. `hold` 가 가장 높으면 기권이다(§7.4) */
export interface RawScore {
  p_long: number
  p_short: number
  p_hold: number
  /** 1~3분 늦게 들어가도 유효한가. 0~1 */
  enter_now: number
}

/**
 * 판단기가 보는 것 — **기준 시각 이전에 알 수 있던 것만**(M5).
 *
 * `asOf` 를 넣어 두는 이유는 판단기가 스스로 「지금」을 묻지 못하게 하려는 것이다.
 * 판단기 안에서 `new Date()` 를 부르면 백테스트가 미래를 본다.
 */
export interface JudgeInput {
  asOf: Date
  contractCode: string
  decisionTf: string
  /** 확정 봉들. 오래된 것부터, 마지막이 판단 대상 봉이다 */
  bars: readonly MinuteBarInput[]
  /** 어떤 진입 조건이 판단을 부르게 했나 */
  trigger: TriggerHit
  /** 세션 시작 후 몇 분인가. 절대 시각을 판단기에 넘기지 않는다(§7.3) */
  minutesSinceOpen: number
  /** 지표. 판단기마다 다시 계산하면 같은 시점에 다른 값을 볼 수 있다 */
  indicators: Indicators
}

export interface Indicators {
  atr: number
  smaFast: number
  smaSlow: number
  /** 최근 N봉 고가·저가 */
  recentHigh: number
  recentLow: number
}

export type Direction = 'long' | 'short'

export interface TriggerHit {
  id: string
  direction: Direction
  /** 왜 걸렸나. 기록에 남아 나중에 같은 조건을 다시 셀 수 있어야 한다 */
  detail: string
}

export type JudgeResult =
  | { status: 'completed'; rawScore: RawScore }
  /** 판단기가 답을 못 냈다. 사유가 반드시 있다 */
  | { status: 'abstain'; abstainReason: string }
  | { status: 'failed'; abstainReason: string }

export interface Judge {
  readonly name: JudgeName
  /**
   * 이 판단기가 **밖으로 나가나**.
   *
   * 이름으로 가르지 않는다 — 이름을 보면 그것이 곧 특권이 된다(§7.2).
   * 밖으로 나가는 판단기만 요청·응답 시각을 남긴다: 안 나갔는데 나간 시각을 적으면
   * 지연 중앙값이 0 쪽으로 끌려 내려가고, 그 숫자로 「사람 지연보다 빠르다」는
   * 틀린 결론이 나온다(§14.2 는 지연을 네 구간으로 가르라고 적는다).
   */
  readonly external: boolean
  /** 이 판단기가 쓴 모델·프롬프트 판. `rule` 은 없다 */
  readonly modelVersion?: string
  readonly promptVersion?: string
  judge(input: JudgeInput): Promise<JudgeResult>
}

/** `hold` 가 가장 높으면 기권이다(§7.4 · D-09) */
export function isHoldDominant(score: RawScore): boolean {
  return score.p_hold >= score.p_long && score.p_hold >= score.p_short
}
