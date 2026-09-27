import 'server-only'

/**
 * 판단에서 신호까지 — **정해진 순서로만** (명세 M2)
 *
 * 판단기는 원점수만 낸다. 그 값이 신호가 되려면 여기를 지나야 하고,
 * 여기는 `decideEmit` 이 정한 다섯 단계를 순서대로 묻는다.
 *
 * ## 지금은 대부분 「보정 없음」에서 멈춘다
 *
 * 보정 모델이 아직 없으므로 원점수는 확률이 아니고, 확률이 아니면 신호를 못 낸다(M3).
 * 그래도 이 길을 지금 배선해 두는 이유: **안 부르는 코드는 안 도는 코드**다.
 * 보정이 생기는 날 「왜 신호가 안 나가지」를 여기서부터 찾게 된다.
 *
 * 막힌 단계와 사유는 실행 기록에 남는다 — 「신호 없음」만으로는 게이트인지 규칙인지 모른다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { decideEmit, blockedSummary, type EmitInput } from '../signal/emit.ts'
import { checkSignalRules, type SignalRuleContext, type SignalRuleThresholds } from '../signal/rules.ts'
import { saveSignal, countSignalsOn, minutesSinceSameDirection } from '../signal/store.ts'
import { queueNotification } from '../notify/outbox.ts'
import { computeRisk, type InstrumentSpec } from '../risk/arithmetic.ts'
import { buildExitPlan } from '../judge/exit-plan-math.ts'
import { DIRECTION_LABEL } from '../signal-labels.ts'
import type { GateHit } from '../gate/safety.ts'
import type { Indicators, TriggerHit } from '../judge/types.ts'
import type { Direction } from '../signal/models-core.ts'

export interface EmitSignalInput {
  judgmentId: string | null
  contractCode: string
  barCloseAt: Date
  trigger: TriggerHit
  indicators: Indicators
  referencePrice: number
  /**
   * 판단기가 고른 방향 (§7.2). 진입 조건의 방향과 **같은 것이 확인된 값**이다 —
   * `agreedDirection` 이 판정하고, 어긋나면 이 창구를 아예 안 부른다
   */
  direction: Direction
  /**
   * 같은 봉의 Jev 판단. 합의를 재고 신호 행에 남긴다 (§13.5).
   * `null` 이면 Jev 가 꺼졌거나 기권한 것이다 — 「반대했다」와 다르다
   */
  jev: { judgmentId: string; direction: Direction | null } | null
  /** 합의가 없으면 신호를 멈추나. 설정이고 기본은 멈춤 */
  requireConsensus: boolean
  instrument: InstrumentSpec
  /** 보정 확률. 없으면 여기서 멈춘다(M3) */
  calibratedProb: number | null
  netExpectedValueR: number | null
  holdDominant: boolean
  enterNowProb: number | null
  gateHits: readonly GateHit[]
  thresholds: SignalRuleThresholds
  rules: {
    minutesSinceOpen: number
    minutesUntilClose: number
    rolloverOrExpiryDay: boolean
    inEventBlackout: boolean
    realizedPnlKrw: number
    remainingLossBudgetKrw: number
    consecutiveLosses: number
    minutesSinceLastLoss: number | null
  }
  exit: {
    stopAtrMultiple: number
    targetAtrMultiple: number
    chaseAtrMultiple: number
    stopSlippageTicks: number
    roundTripFeeKrw: number
    timeExitMinutes: number
    sessionCloseAt: Date
  }
  versions: {
    signalRules: string
    calibration: string | null
    evModel: string | null
  }
  sessionDayStart: Date
  sessionDayEnd: Date
  now: Date
}

export interface EmitSignalResult {
  /** 「나갔다」 또는 「어디서 왜 막혔나」 */
  reason: string
  signalId: string | null
}

export async function emitSignal(input: EmitSignalInput): Promise<EmitSignalResult> {
  /**
   * 방향은 **받는다.** 여기서 진입 조건으로 다시 정하지 않는다.
   *
   * 전에는 이 자리가 `input.trigger.direction` 이었고, 보정 모델은 원점수의 방향으로
   * 골랐다. 둘이 어긋나면 롱 보정으로 숏 신호가 나가고 손절가가 반대로 붙는다.
   * 어긋났는지는 부르는 쪽이 이미 판정했고, 어긋났으면 여기까지 안 온다.
   */
  const direction = input.direction
  const atr = input.indicators.atr

  /**
   * 청산 계획은 **백테스트와 같은 함수**로 만든다 (M4).
   *
   * 전에는 이 자리에 식을 직접 적었고 백테스트는 자기 것을 갖고 있었다. 사본이 둘이면
   * 고칠 때 한쪽만 고치는 날이 오고, 그날부터 백테스트 성적은 실제로 안 도는 전략의 것이다.
   */
  const plan = buildExitPlan(direction, input.referencePrice, atr, {
    stopAtrMultiple: input.exit.stopAtrMultiple,
    targetAtrMultiple: input.exit.targetAtrMultiple,
    chaseAtrMultiple: input.exit.chaseAtrMultiple,
    timeExitMinutes: input.exit.timeExitMinutes,
  }, input.exit.sessionCloseAt)
  const stopPrice = plan.stopPrice
  const targetPrice = plan.targetPrice

  const risk = computeRisk({
    direction,
    instrument: input.instrument,
    referencePrice: input.referencePrice,
    stopPrice,
    chaseDistance: input.exit.chaseAtrMultiple * atr,
    stopSlippageTicks: input.exit.stopSlippageTicks,
    roundTripFeeKrw: input.exit.roundTripFeeKrw,
    quantity: 1,
  })

  const signalsToday = await countSignalsOn(input.contractCode, input.sessionDayStart, input.sessionDayEnd)
  const sinceSame = await minutesSinceSameDirection(input.contractCode, direction, input.now)

  const ruleContext: SignalRuleContext = {
    calibratedProb: input.calibratedProb,
    netExpectedValueR: input.netExpectedValueR,
    enterNowProb: input.enterNowProb,
    holdDominant: input.holdDominant,
    minutesSinceOpen: input.rules.minutesSinceOpen,
    minutesUntilClose: input.rules.minutesUntilClose,
    rolloverOrExpiryDay: input.rules.rolloverOrExpiryDay,
    inEventBlackout: input.rules.inEventBlackout,
    realizedPnlKrw: input.rules.realizedPnlKrw,
    riskPerTradeKrw: risk.riskPerTradeKrw,
    remainingLossBudgetKrw: input.rules.remainingLossBudgetKrw,
    consecutiveLosses: input.rules.consecutiveLosses,
    minutesSinceLastLoss: input.rules.minutesSinceLastLoss,
    signalsToday,
    minutesSinceSameDirection: sinceSame,
    targetDistancePoints: Math.abs(targetPrice - input.referencePrice),
    roundTripCostPoints: input.instrument.multiplier > 0
      ? input.exit.roundTripFeeKrw / input.instrument.multiplier
      : 0,
  }

  /**
   * 판단기들이 같은 방향을 말했나 (§7.2).
   *
   * Jev 가 없거나 기권했으면 `null` 이다 — **「반대했다」와 다른 사실**이다.
   * 둘을 섞으면 키를 안 넣은 날과 Jev 가 반대한 날이 같은 얼굴이 된다.
   */
  const consensus = input.jev && input.jev.direction
    ? {
      agreed: input.jev.direction === direction,
      reason: `${direction}vs${input.jev.direction}`,
    }
    : null

  const emitInput: EmitInput = {
    gateHits: input.gateHits,
    triggerFired: true,
    judgeCompleted: input.judgmentId !== null,
    judgeAbstainReason: null,
    consensus,
    requireConsensus: input.requireConsensus,
    hasCalibration: input.calibratedProb !== null,
    ruleBlocks: checkSignalRules(ruleContext, input.thresholds),
  }

  const outcome = decideEmit(emitInput)
  if (outcome.kind !== 'signal') {
    return { reason: blockedSummary(outcome), signalId: null }
  }
  if (!input.judgmentId) {
    // 여기 오면 `judgeCompleted` 판정이 틀린 것이다. 조용히 넘기지 않는다
    return { reason: 'emit:no_judgment_id', signalId: null }
  }

  const saved = await saveSignal({
    judgmentId: input.judgmentId,
    contractCode: input.contractCode,
    direction,
    referencePrice: input.referencePrice,
    jevJudgmentId: input.jev?.judgmentId ?? null,
    consensus: consensus
      ? `${consensus.agreed ? 'agreed' : 'disagreed'}:${consensus.reason}`
      : 'single:rule',
    stopPrice,
    targetPrice,
    chaseLimitPrice: risk.worstEntryPrice,
    timeExitMinutes: input.exit.timeExitMinutes,
    sessionCloseAt: input.exit.sessionCloseAt,
    calibratedProb: input.calibratedProb,
    netExpectedValueR: input.netExpectedValueR,
    riskPerTradeKrw: risk.riskPerTradeKrw,
    signalRulesVersion: input.versions.signalRules,
    calibrationVersion: input.versions.calibration,
    evModelVersion: input.versions.evModel,
    barCloseAt: input.barCloseAt,
  })
  if (!saved.saved) return { reason: `emit:${saved.reason}`, signalId: null }

  /**
   * 알림은 바로 안 보낸다 — 대기 표를 지난다(§14.3 D-33).
   * 넣는 데 실패해도 신호는 이미 저장됐다. 곁가지가 본 일을 죽이지 않는다.
   */
  const queued = await queueNotification({
    signalId: saved.signalId,
    kind: 'signal',
    title: `${DIRECTION_LABEL[direction]} 신호`,
    body: `기준 ${input.referencePrice.toFixed(2)} · 손절 ${stopPrice.toFixed(2)} · 목표 ${targetPrice.toFixed(2)}`,
  })
  await markNotifyQueued(saved.signalId, input.now)

  return {
    reason: queued.queued ? 'emit:signal' : `emit:signal,notify_${queued.reason}`,
    signalId: saved.signalId,
  }
}

/** 발송 시각의 앞자리. 대기 표에 넣은 때를 신호에도 적어 둔다(§14.2) */
async function markNotifyQueued(signalId: string, now: Date): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('trading_signals')
    .update({ notify_sent_at: now.toISOString() })
    .eq('id', signalId)
    .is('notify_sent_at', null)
  if (error) throw new Error(`발송 시각을 적지 못했습니다: ${error.message}`)
}
