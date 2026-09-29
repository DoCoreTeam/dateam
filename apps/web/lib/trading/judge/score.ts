/**
 * 판단 채점 — **예측만 하고 맞았는지를 안 세면 정보가 아니다**
 *
 * ## 왜 필요한가
 *
 * 사용자 지시 2026-09-29: 「어차피 거래는 내가 직접 할거야 이건 정보를 주는 서비스라구」.
 * 정보 서비스의 신뢰는 「지금 숏」이 아니라 **「그동안 얼마나 맞았나」**에서 나온다.
 * 그런데 `trading_judgments` 에는 결과 칼럼이 없었다 — 매분 예측하고 채점은 한 번도 안 했다.
 *
 * ## 왜 셈을 새로 안 적나 (M4)
 *
 * 채점은 `replay/execution.ts` 의 `replayExecution` 을 **그대로** 쓴다. 백테스트가 성적을
 * 내는 그 함수다. 여기서 「목표에 닿았나」를 다시 적으면 화면이 말하는 적중률과 검증이 내는
 * 성적이 갈리고, 갈린 날 사람은 어느 쪽을 믿을지 정해야 한다.
 *
 * ## 안 끝난 것은 진 것이 아니다
 *
 * 뒤 봉이 모자라 아직 결판이 안 난 판단은 `pending` 이다. 이것을 빗나감으로 세면
 * **방금 낸 판단일수록 틀린 것으로 잡혀** 적중률이 실제보다 낮게 나온다.
 */

import { buildExitPlan, type ExitPlanParams } from './exit-plan-math.ts'
import { computeIndicators, requiredBarCount, type IndicatorParams } from './indicators.ts'
import { replayExecution, type OrderKind } from '../replay/execution.ts'
import { computeRisk, type InstrumentSpec } from '../risk/arithmetic.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

/** 채점할 판단 하나. 방향이 없는 판단(관망)은 여기 안 들어온다 */
export interface JudgmentToScore {
  id: string
  /** 봉이 닫힌 때 (ISO). 그 봉이 이 판단의 기준이다 */
  barCloseAt: string
  direction: 'long' | 'short'
  judge: string
}

export interface ScoreParams {
  indicators: IndicatorParams
  exit: ExitPlanParams
  instrument: InstrumentSpec
  quantity: number
  /** 판단 → 주문까지 지연(분). 실시간과 같은 값을 쓴다 */
  delayMinutes: number
  orderKind: OrderKind
  slippagePoints: number
  stopSlippagePoints: number
  roundTripFeeKrw: number
  /** 그날 당일 청산 시각 */
  sessionCloseAt(barStartAt: Date): Date
}

/**
 * 무엇이 먼저 닿았나.
 *
 * `pending` 은 **아직 안 끝남**이다 — 빗나감과 섞으면 최근 판단일수록 진 것으로 잡힌다.
 * `no_plan` 은 지표가 모자라 계획 자체를 못 세운 것이다.
 */
export type ScoreOutcome =
  | 'target' | 'stop' | 'time' | 'session_close' | 'not_filled' | 'pending' | 'no_plan'

export interface JudgmentScore {
  judgmentId: string
  judge: string
  direction: 'long' | 'short'
  /** 이 판단이 선 봉 (ISO) */
  barAt: string
  referencePrice: number | null
  stopPrice: number | null
  targetPrice: number | null
  outcome: ScoreOutcome
  /** 비용 포함 순손익(원). 안 끝났으면 null — 0 원과 다른 사실이다 */
  netPnlKrw: number | null
  /** 1회 위험 대비 손익(R). 안 끝났으면 null */
  netPnlR: number | null
  /** 왜 이 결과인가. 조용히 비워 두지 않는다 */
  reason: string
}

/** 맞았다고 셀 것. 목표에 닿은 것만이다 — 시간 청산은 이겼을 수도 졌을 수도 있다 */
export function isHit(score: JudgmentScore): boolean {
  return score.outcome === 'target'
}

/** 적중률 분모에 드는가. 안 끝났거나 계획을 못 세운 것은 안 센다 */
export function isSettled(score: JudgmentScore): boolean {
  return score.outcome === 'target' || score.outcome === 'stop'
    || score.outcome === 'time' || score.outcome === 'session_close'
}

const MINUTE_MS = 60_000

/**
 * 판단 하나를 채점한다.
 *
 * `bars` 는 **오래된 것부터** 전부 준다. 기준 봉 앞은 지표에, 뒤는 결과 판정에 쓴다.
 */
export function scoreJudgment(
  judgment: JudgmentToScore,
  bars: readonly MinuteBarInput[],
  params: ScoreParams,
): JudgmentScore {
  const base: JudgmentScore = {
    judgmentId: judgment.id,
    judge: judgment.judge,
    direction: judgment.direction,
    barAt: '',
    referencePrice: null, stopPrice: null, targetPrice: null,
    outcome: 'no_plan', netPnlKrw: null, netPnlR: null, reason: '',
  }

  /**
   * 판단 시각은 봉이 **닫힌** 때라 그 봉은 시작이 1분 앞이다.
   * 표식·계획과 같은 규칙을 써야 셋이 같은 봉을 가리킨다.
   */
  const closeAt = Date.parse(judgment.barCloseAt)
  if (!Number.isFinite(closeAt)) return { ...base, reason: 'bar_close_at_unreadable' }
  const index = bars.findIndex((b) => b.startAt.getTime() === closeAt - MINUTE_MS)
  if (index < 0) return { ...base, reason: 'bar_not_found' }

  const bar = bars[index]
  const need = requiredBarCount(params.indicators)
  // 그 봉까지만. 뒤 봉을 섞으면 그때 세울 수 없던 계획이 된다(M5)
  const seen = bars.slice(0, index + 1)
  if (seen.length < need) {
    return { ...base, barAt: bar.startAt.toISOString(), reason: `not_enough_bars:${seen.length}<${need}` }
  }
  const indicators = computeIndicators(seen, params.indicators)
  if (!indicators || !(indicators.atr > 0)) {
    return { ...base, barAt: bar.startAt.toISOString(), reason: 'indicators_unavailable' }
  }

  const referencePrice = bar.close
  const plan = buildExitPlan(
    judgment.direction, referencePrice, indicators.atr, params.exit,
    params.sessionCloseAt(bar.startAt),
  )
  const withPlan: JudgmentScore = {
    ...base,
    barAt: bar.startAt.toISOString(),
    referencePrice,
    stopPrice: plan.stopPrice,
    targetPrice: plan.targetPrice,
  }

  const risk = computeRisk({
    direction: judgment.direction,
    instrument: params.instrument,
    quantity: params.quantity,
    referencePrice,
    stopPrice: plan.stopPrice,
    chaseDistance: Math.abs(plan.chaseLimitPrice - referencePrice),
    stopSlippageTicks: params.stopSlippagePoints / params.instrument.tickSize,
    roundTripFeeKrw: params.roundTripFeeKrw,
  })

  const replay = replayExecution(
    {
      direction: judgment.direction,
      signalPrice: referencePrice,
      signalAt: new Date(closeAt),
      plan,
      delayMinutes: params.delayMinutes,
      orderKind: params.orderKind,
      slippagePoints: params.slippagePoints,
      stopSlippagePoints: params.stopSlippagePoints,
      contractValue: params.instrument.multiplier * params.quantity,
      roundTripFeeKrw: params.roundTripFeeKrw,
    },
    bars,
  )

  /**
   * **봉이 떨어져 끝난 것은 끝난 것이 아니다.**
   *
   * `replayExecution` 은 구간 끝에 걸린 거래를 마지막 봉 종가로 정리하고
   * `ran_out_of_bars` 라고 적는다. 백테스트에서는 그 편이 맞다(버리면 성적이 좋아진다).
   * 그런데 **화면 적중률에서는 다르다** — 방금 낸 판단이 늘 그 자리에 걸리므로,
   * 그것을 결과로 세면 최근 판단일수록 진 것으로 잡힌다.
   */
  if (replay.reason === 'ran_out_of_bars') {
    return { ...withPlan, outcome: 'pending', reason: 'still_open' }
  }
  if (!replay.filled) {
    return { ...withPlan, outcome: 'not_filled', reason: replay.reason }
  }
  return {
    ...withPlan,
    outcome: replay.exitKind === 'not_filled' ? 'not_filled' : replay.exitKind,
    netPnlKrw: replay.netPnlKrw,
    netPnlR: risk.riskPerTradeKrw > 0 ? replay.netPnlKrw / risk.riskPerTradeKrw : null,
    reason: replay.reason,
  }
}

/** 채점 한 묶음을 **돈으로** 요약한다 — 적중률만으로는 돈이 되는지 알 수 없다 */
export interface ScoreSummary {
  /** 결판난 건수. 적중률의 분모다 */
  settled: number
  /** 목표에 닿은 건수 */
  hit: number
  /** 아직 안 끝난 건수. 분모에 안 든다 */
  pending: number
  /** 계획을 못 세웠거나 체결 자리가 없던 건수 */
  unscored: number
  /** 적중률(0~1). 결판난 것이 0건이면 null */
  hitRate: number | null
  /**
   * 합계 손익(R)과 건당 평균(R). **이것이 돈이다.**
   * 적중률이 높아도 평균이 음수면 그 예측은 돈을 잃는다
   */
  totalR: number | null
  averageR: number | null
  netKrw: number | null
}

export function summarizeScores(scores: readonly JudgmentScore[]): ScoreSummary {
  const settled = scores.filter(isSettled)
  const pending = scores.filter((s) => s.outcome === 'pending').length
  const unscored = scores.length - settled.length - pending
  const withR = settled.filter((s) => s.netPnlR !== null)
  const totalR = withR.length > 0 ? withR.reduce((a, s) => a + (s.netPnlR ?? 0), 0) : null
  const netKrw = settled.filter((s) => s.netPnlKrw !== null).length > 0
    ? settled.reduce((a, s) => a + (s.netPnlKrw ?? 0), 0)
    : null
  return {
    settled: settled.length,
    hit: settled.filter(isHit).length,
    pending,
    unscored,
    // 0건이면 **0% 가 아니라 모름**이다. 0% 는 「다 틀렸다」는 사실이 된다
    hitRate: settled.length > 0 ? settled.filter(isHit).length / settled.length : null,
    totalR,
    averageR: totalR !== null && withR.length > 0 ? totalR / withR.length : null,
    netKrw,
  }
}
