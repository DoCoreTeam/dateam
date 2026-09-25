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
import { DIRECTION_LABEL } from '../signal-labels.ts'
import type { GateHit } from '../gate/safety.ts'
import type { Indicators, TriggerHit } from '../judge/types.ts'

export interface EmitSignalInput {
  judgmentId: string | null
  contractCode: string
  barCloseAt: Date
  trigger: TriggerHit
  indicators: Indicators
  referencePrice: number
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
  const direction = input.trigger.direction
  const atr = input.indicators.atr

  const stopPrice = direction === 'long'
    ? input.referencePrice - input.exit.stopAtrMultiple * atr
    : input.referencePrice + input.exit.stopAtrMultiple * atr
  const targetPrice = direction === 'long'
    ? input.referencePrice + input.exit.targetAtrMultiple * atr
    : input.referencePrice - input.exit.targetAtrMultiple * atr

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

  const emitInput: EmitInput = {
    gateHits: input.gateHits,
    triggerFired: true,
    judgeCompleted: input.judgmentId !== null,
    judgeAbstainReason: null,
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
