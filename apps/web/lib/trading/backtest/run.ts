/**
 * 신호 백테스트 — **실시간과 같은 함수를 과거 봉에 돌린다** (명세 §13.1 · M4)
 *
 * ## 왜 같은 함수여야 하나
 *
 * 백테스트용으로 진입 조건을 따로 적으면, 고칠 때 한쪽만 고치는 날이 온다.
 * 그날부터 백테스트는 **실제로 안 도는 전략**의 성적을 말하고, 그 성적으로 관문을 통과한다.
 * 그래서 이 파일은 지표도 조건도 판단기도 확정 봉 규칙도 **하나도 새로 안 만든다** —
 * 전부 `lib/trading/judge` 와 `lib/trading/bars` 에서 그대로 들여온다.
 * `lib/policy/trading-backtest-parity.test.ts` 가 복사본이 생기는지 센다.
 *
 * ## 무엇을 재나
 *
 * §13.1 은 **신호 시점 가격**으로 청산 계획을 적용한 성과를 재라고 한다(판단기 자체의 가치).
 * §13.2 는 사람이 따라 했을 때를 재라고 한다(체결 재현). 둘 다 필요하고 둘은 다르다 —
 * 앞은 「전략이 좋은가」, 뒤는 「우리가 그것으로 돈을 버는가」이다.
 */

import type { MinuteBarInput } from '../bars/confirm.ts'
import { computeIndicators, evaluateTriggers, requiredBarCount, type TriggerParams } from '../judge/indicators.ts'
import type { Judge, JudgeInput, RawScore } from '../judge/types.ts'
import { replayExecution, type ExitPlan, type OrderKind, type ReplayResult } from '../replay/execution.ts'
import { computeRisk, toR, type InstrumentSpec } from '../risk/arithmetic.ts'

export interface ExitPlanParams {
  /** 손절 = 기준가 ∓ 이 배수 × ATR (§8) */
  stopAtrMultiple: number
  /** 목표 = 기준가 ± 이 배수 × ATR */
  targetAtrMultiple: number
  /** 진입 한계 = 기준가 ± 이 배수 × ATR */
  chaseAtrMultiple: number
  timeExitMinutes: number
}

export interface BacktestParams {
  triggers: TriggerParams
  exit: ExitPlanParams
  instrument: InstrumentSpec
  quantity: number
  /** 신호 → 주문 지연(분) */
  delayMinutes: number
  orderKind: OrderKind
  /** 슬리피지 틱 수. 민감도 표의 한 줄이다 */
  slippageTicks: number
  stopSlippageTicks: number
  roundTripFeeKrw: number
  /** 그날 당일 청산 시각을 돌려준다 */
  sessionCloseAt(barStartAt: Date): Date
  /** 이 시각이 판단 대상 구간인가 (단일가·장외를 빼는 자리) */
  isDecidable(barStartAt: Date): boolean
  /** 세션 시작 후 경과 분 */
  minutesSinceOpen(barStartAt: Date): number
}

export interface BacktestTrade {
  barCloseAt: Date
  direction: 'long' | 'short'
  triggerId: string
  rawScore: RawScore
  signalPrice: number
  /** 체결 재현 결과 (§13.2) */
  replay: ReplayResult
  /** 1회 위험(원). R 환산의 분모다 */
  riskPerTradeKrw: number
  netPnlR: number | null
}

export interface BacktestSummary {
  trades: BacktestTrade[]
  /** 조건이 걸렸지만 판단기가 기권한 수 */
  abstained: number
  /** 지표가 모자라 건너뛴 봉 수 */
  skippedForIndicators: number
  /** 판단 대상이 아니라 건너뛴 봉 수 */
  skippedNotDecidable: number
}

const MINUTE_MS = 60_000

/** 청산 계획 — 방향이 부호를 정한다 (§8) */
export function buildExitPlan(
  direction: 'long' | 'short',
  referencePrice: number,
  atr: number,
  params: ExitPlanParams,
  sessionCloseAt: Date,
): ExitPlan {
  const sign = direction === 'long' ? 1 : -1
  return {
    stopPrice: referencePrice - sign * params.stopAtrMultiple * atr,
    targetPrice: referencePrice + sign * params.targetAtrMultiple * atr,
    chaseLimitPrice: referencePrice + sign * params.chaseAtrMultiple * atr,
    timeExitMinutes: params.timeExitMinutes,
    sessionCloseAt,
  }
}

/**
 * 과거 봉에 전략을 돌린다.
 *
 * @param bars 오래된 것부터. 한 봉씩 앞으로 가며 **그 시점까지의 봉만** 본다(M5)
 */
export async function runBacktest(
  bars: readonly MinuteBarInput[],
  judge: Judge,
  params: BacktestParams,
): Promise<BacktestSummary> {
  const need = requiredBarCount(params.triggers)
  const summary: BacktestSummary = {
    trades: [], abstained: 0, skippedForIndicators: 0, skippedNotDecidable: 0,
  }

  for (let i = 0; i < bars.length; i += 1) {
    const current = bars[i]
    if (!params.isDecidable(current.startAt)) { summary.skippedNotDecidable += 1; continue }

    /**
     * **그 시점까지의 봉만** 자른다. 전체 배열을 넘기면 지표가 미래를 본다 —
     * 이 한 줄이 백테스트의 정직함 전부다(M5).
     */
    const seen = bars.slice(Math.max(0, i + 1 - need - 5), i + 1)
    const indicators = computeIndicators(seen, params.triggers)
    if (!indicators) { summary.skippedForIndicators += 1; continue }

    const trigger = evaluateTriggers(seen, indicators, params.triggers)
    if (!trigger) continue

    const input: JudgeInput = {
      asOf: new Date(current.startAt.getTime() + MINUTE_MS),
      contractCode: '',
      decisionTf: '1m',
      bars: seen,
      trigger,
      minutesSinceOpen: params.minutesSinceOpen(current.startAt),
      indicators,
    }
    const result = await judge.judge(input)
    if (result.status !== 'completed') { summary.abstained += 1; continue }

    const signalPrice = current.close
    const plan = buildExitPlan(
      trigger.direction, signalPrice, indicators.atr, params.exit,
      params.sessionCloseAt(current.startAt),
    )

    const risk = computeRisk({
      direction: trigger.direction,
      instrument: params.instrument,
      referencePrice: signalPrice,
      stopPrice: plan.stopPrice,
      chaseDistance: Math.abs(plan.chaseLimitPrice - signalPrice),
      stopSlippageTicks: params.stopSlippageTicks,
      roundTripFeeKrw: params.roundTripFeeKrw,
      quantity: params.quantity,
    })

    const replay = replayExecution({
      direction: trigger.direction,
      signalPrice,
      signalAt: new Date(current.startAt.getTime() + MINUTE_MS),
      plan,
      delayMinutes: params.delayMinutes,
      orderKind: params.orderKind,
      slippagePoints: params.slippageTicks * params.instrument.tickSize,
      stopSlippagePoints: params.stopSlippageTicks * params.instrument.tickSize,
      contractValue: params.instrument.multiplier * params.quantity,
      roundTripFeeKrw: params.roundTripFeeKrw,
    }, bars.slice(i + 1))

    summary.trades.push({
      barCloseAt: new Date(current.startAt.getTime() + MINUTE_MS),
      direction: trigger.direction,
      triggerId: trigger.id,
      rawScore: result.rawScore,
      signalPrice,
      replay,
      riskPerTradeKrw: risk.riskPerTradeKrw,
      netPnlR: replay.filled ? toR(replay.netPnlKrw, risk.riskPerTradeKrw) : null,
    })
  }

  return summary
}
