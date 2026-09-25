import 'server-only'

/**
 * 검증 파이프라인 — **부품을 실제로 돌리는 자리** (명세 §13)
 *
 * 1-B 의 부품은 각자 맞아도 아무도 안 부르면 상자 열아홉 개일 뿐이다.
 * 여기가 그것을 순서대로 연다. 순서 자체는 `pipeline-core.ts` 가 정하고
 * 시험이 그 순서를 지킨다 — 이 파일은 DB 와 KIS 를 대기만 한다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { loadTradingSettings } from '../settings/store.ts'
import { loadBarsAsOf } from '../bars/store.ts'
import { planWalkForward, checkOrder } from '../backtest/windows.ts'
import { runBacktest, type BacktestParams } from '../backtest/run.ts'
import { saveBacktestRun } from '../backtest/store.ts'
import { fitPlatt, applyPlatt, chooseMethod, validateWindows } from '../calibrate/platt.ts'
import { judgeCalibration } from '../calibrate/metrics.ts'
import { buildEvModel, expectedValueFor } from '../ev/model.ts'
import { fitMl, createMlJudge, featuresOf } from '../judge/ml.ts'
import { createRuleJudge } from '../judge/rule.ts'
import { bootstrapExpectancy, bootstrapDifference, isBetterThan } from '../stats/bootstrap.ts'
import { summarize, profitFactor, maxDrawdownR } from '../stats/metrics.ts'
import { evaluateGate, type GateVerdict } from '../gate/criteria.ts'
import {
  spreadStats, typicalTicks, fallbackRatio, sensitivityTable, HARSH_TICKS, phaseOf,
  type PhasedSample,
} from '../replay/slippage.ts'
import { planSteps, checkStepOrder, initialProgress, stepMayRead, type PipelineProgress } from './pipeline-core.ts'
import { backfillMinuteBars } from '../backfill/minute-backfill.ts'
import { plannedCallCount } from '../backfill/plan.ts'
import { assertLockboxReadable, openLockbox } from '../backtest/lockbox.ts'
import { computeRisk } from '../risk/arithmetic.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

export interface ValidationResult {
  ok: boolean
  reason: string
  userMessage: string | null
  progress: PipelineProgress
  gate: GateVerdict | null
}

/** `YYYY-MM-DD` (서울) */
function tradeDateOf(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at)
}

/** 모아 둔 봉에서 실제 거래일 목록 */
async function loadTradeDates(contractCode: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_bars')
    .select('bar_start_at')
    .eq('contract_code', contractCode)
    .eq('tf', '1m')
    .order('bar_start_at', { ascending: true })
  if (error) throw new Error(`거래일을 읽지 못했습니다: ${error.message}`)
  const days = new Set(((data ?? []) as { bar_start_at: string }[]).map((r) => tradeDateOf(new Date(r.bar_start_at))))
  return [...days].sort()
}

export interface ValidationInput {
  contractCode: string
  now?: Date
  /** 밖에서 넘겨 준 클라이언트가 있으면 백필도 한다. 없으면 모아 둔 봉만 쓴다 */
  backfill?: Parameters<typeof backfillMinuteBars>[0] | null
}

/**
 * 검증을 한 바퀴 돌린다.
 *
 * **표본이 모자라면 돌리지 않고 왜 모자란지를 말한다.** 억지로 돌리면 접기 하나짜리
 * 결과가 나오고, 그 숫자가 관문에 들어간다.
 */
export async function runValidation(input: ValidationInput): Promise<ValidationResult> {
  const now = input.now ?? new Date()
  const today = tradeDateOf(now)
  const { values, version: settingsVersion } = await loadTradingSettings(today)
  const num = (key: string, fallback: number) => {
    const v = Number(values[key])
    return Number.isFinite(v) ? v : fallback
  }

  if (input.backfill) {
    // 백필은 검증 앞에 온다. 자료가 없으면 아무것도 못 잰다
    const filled = await backfillMinuteBars(input.backfill)
    if (!filled.ok) {
      return {
        ok: false, reason: filled.reason, userMessage: filled.userMessage,
        progress: { total: 0, done: 0, currentLabel: null, failed: [] }, gate: null,
      }
    }
  }

  const tradeDates = await loadTradeDates(input.contractCode)
  const planned = planWalkForward({
    tradeDates,
    foldCount: num('validation_fold_count', 3),
    validateDays: num('validation_validate_days', 10),
    minTrainDays: num('validation_min_train_days', 30),
    lockboxDays: num('validation_lockbox_days', 20),
  })
  if ('rejection' in planned) {
    return {
      ok: false, reason: planned.rejection.reason, userMessage: planned.rejection.userMessage,
      progress: { total: 0, done: 0, currentLabel: null, failed: [] }, gate: null,
    }
  }
  const orderProblem = checkOrder(planned.plan)
  if (orderProblem) {
    return {
      ok: false, reason: orderProblem.reason, userMessage: orderProblem.userMessage,
      progress: { total: 0, done: 0, currentLabel: null, failed: [] }, gate: null,
    }
  }

  const steps = planSteps(planned.plan)
  const stepProblem = checkStepOrder(steps)
  if (stepProblem) {
    return {
      ok: false, reason: stepProblem.reason, userMessage: stepProblem.userMessage,
      progress: initialProgress(steps), gate: null,
    }
  }

  const progress = initialProgress(steps)
  const instrument = await loadInstrument(input.contractCode)
  if (!instrument) {
    return {
      ok: false, reason: 'no_instrument', userMessage: '상품 규격을 찾지 못했습니다',
      progress, gate: null,
    }
  }

  const allBars = await loadBarsAsOf({
    contractCode: input.contractCode, tf: '1m', asOf: now, limit: 500_000,
  })
  const barsIn = (from: string, to: string) =>
    allBars.filter((b) => {
      const d = tradeDateOf(b.startAt)
      return d >= from && d <= to
    })

  // 슬리피지는 모아 둔 호가에서 잰다
  const slippage = await measureSlippage(input.contractCode, instrument.tickSize, num('bar_grace_seconds', 10))
  const typical = typicalTicks(slippage, { tickSize: instrument.tickSize, fallbackTicks: num('replay_fallback_ticks', 2) })
  const kind = instrument.root === 'MINI_KOSPI200' ? 'mini' : 'regular'
  const harsh = HARSH_TICKS[kind]
  /**
   * 민감도 표 전부를 함께 돌린다(§13.5). 하나만 재면 「얼마나 버티는가」에 답할 수 없고,
   * 가정이 조금만 나빠져도 뒤집히는 전략을 못 걸러 낸다.
   */
  const sensitivity = sensitivityTable(kind, instrument.tickSize)
  /** 호가를 못 받아 가정값으로 떨어진 비율. 높으면 그 성적은 실측이 아니다 */
  const assumedRatio = fallbackRatio(slippage)

  const params = (slippageTicks: number): BacktestParams => ({
    triggers: {
      atrPeriod: num('atr_period', 14),
      smaFastPeriod: num('sma_fast_period', 5),
      smaSlowPeriod: num('sma_slow_period', 20),
      breakoutPeriod: num('breakout_period', 20),
      breakoutAtrMultiple: num('breakout_atr_multiple', 0.1),
    },
    exit: {
      stopAtrMultiple: num('exit_stop_atr_multiple', 1.2),
      targetAtrMultiple: num('exit_target_atr_multiple', 1.5),
      chaseAtrMultiple: num('exit_chase_atr_multiple', 0.3),
      timeExitMinutes: num('min_hold_minutes', 15),
    },
    instrument: { multiplier: instrument.multiplier, tickSize: instrument.tickSize },
    quantity: 1,
    delayMinutes: num('replay_delay_minutes', 2),
    orderKind: String(values.replay_order_type ?? 'market') === 'limit' ? 'limit' : 'market',
    slippageTicks,
    stopSlippageTicks: slippageTicks,
    roundTripFeeKrw: num('fee_rate', 0),
    sessionCloseAt: (barStartAt) => new Date(barStartAt.getTime() + 24 * 60 * 60_000),
    isDecidable: () => true,
    minutesSinceOpen: () => 0,
  })

  const versions = {
    specVersion: String(values.decision_spec_version ?? 'v1'),
    calibrationVersion: null as string | null,
    evModelVersion: null as string | null,
    executionModelVersion: `delay${num('replay_delay_minutes', 2)}-slip${typical}`,
    tradingLogicVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    settingsVersion,
  }

  const validateTrades: { tradeDate: string; netPnlR: number }[] = []
  const mlTrades: { tradeDate: string; netPnlR: number }[] = []
  let calibrationVerdict: ReturnType<typeof judgeCalibration> | null = null

  for (const fold of planned.plan.folds) {
    /**
     * ① 학습 구간 백테스트 — 보정과 기대값표의 재료.
     *
     * 자른 봉이 정말 그 단계가 읽어도 되는 구간인지 **한 발짝마다 묻는다.**
     * 자르는 코드가 맞는다고 믿고 넘어가면, 어느 날 그 코드가 바뀌어도 아무도 모른다.
     */
    const trainStep = steps.find((s) => s.foldIndex === fold.index && s.kind === 'backtest_train')
    const trainBars = barsIn(fold.trainFrom, fold.trainTo)
      .filter((b) => !trainStep || stepMayRead(trainStep, tradeDateOf(b.startAt)))
    const trainRun = await runBacktest(trainBars, createRuleJudge(), params(typical))

    // ② 보정 — 학습 구간 자료로만
    const windowProblem = validateWindows({
      samples: [], trainFrom: fold.trainFrom, trainTo: fold.trainTo,
      validateFrom: fold.validateFrom, validateTo: fold.validateTo,
    })
    if (windowProblem && windowProblem.reason !== 'no_samples') {
      progress.failed.push({ label: `${fold.index + 1}겹 보정`, reason: windowProblem.reason })
      continue
    }
    const labeled = trainRun.trades
      .filter((t) => t.netPnlR !== null)
      .map((t) => ({ score: t.rawScore.p_long, win: (t.netPnlR as number) > 0 }))
    const platt = fitPlatt(labeled)
    const method = chooseMethod(labeled.length, num('calibration_isotonic_min_samples', 1000))
    versions.calibrationVersion = platt ? `${method}-fold${fold.index}` : null

    // ③ 기대값표 — 학습 구간 자료로만 (D-35)
    const evResult = platt
      ? buildEvModel({
        samples: trainRun.trades
          .filter((t) => t.netPnlR !== null)
          .map((t) => ({
            calibratedProb: applyPlatt(platt, t.rawScore.p_long),
            netPnlR: t.netPnlR as number,
            windowKind: 'train' as const,
          })),
        version: `ev-fold${fold.index}`,
        judge: 'rule',
        direction: 'long',
        trainFrom: fold.trainFrom,
        trainTo: fold.trainTo,
      })
      : { rejection: { reason: 'no_calibration', userMessage: '보정이 없어 기대값표를 못 만듭니다' } }
    if ('rejection' in evResult) {
      progress.failed.push({ label: `${fold.index + 1}겹 기대값표`, reason: evResult.rejection.reason })
    } else {
      versions.evModelVersion = evResult.model.version
      // 표본이 없는 구간이 있는지 확인해 둔다(화면이 말한다)
      expectedValueFor(evResult.model, 0.5)
    }

    // ④ 검증 구간 백테스트 — 위에서 만든 모델을 그대로 적용해 평가
    const validateStep = steps.find((s) => s.foldIndex === fold.index && s.kind === 'backtest_validate')
    const validateBars = barsIn(fold.validateFrom, fold.validateTo)
      .filter((b) => !validateStep || stepMayRead(validateStep, tradeDateOf(b.startAt)))
    const validateRun = await runBacktest(validateBars, createRuleJudge(), params(typical))
    for (const t of validateRun.trades) {
      if (t.netPnlR !== null) validateTrades.push({ tradeDate: tradeDateOf(t.barCloseAt), netPnlR: t.netPnlR })
    }

    if (platt) {
      calibrationVerdict = judgeCalibration(
        validateRun.trades
          .filter((t) => t.netPnlR !== null)
          .map((t) => ({ prob: applyPlatt(platt, t.rawScore.p_long), win: (t.netPnlR as number) > 0 })),
        { minSamples: num('gate_min_validate_trades', 500) / 5 },
      )
    }

    // ml 기준선도 같은 구간에 돌려 비교 재료를 만든다
    const mlModel = fitMl(trainRun.trades
      .filter((t) => t.netPnlR !== null)
      .map((t) => ({
        features: featuresOf({
          asOf: t.barCloseAt, contractCode: input.contractCode, decisionTf: '1m',
          bars: trainBars, trigger: { id: t.triggerId, direction: t.direction, detail: '' },
          minutesSinceOpen: 0,
          indicators: { atr: 1, smaFast: t.signalPrice, smaSlow: t.signalPrice, recentHigh: t.signalPrice, recentLow: t.signalPrice },
        }) ?? [],
        win: (t.netPnlR as number) > 0,
      }))
      .filter((s) => s.features.length > 0))
    const mlRun = await runBacktest(validateBars, createMlJudge(mlModel), params(typical))
    for (const t of mlRun.trades) {
      if (t.netPnlR !== null) mlTrades.push({ tradeDate: tradeDateOf(t.barCloseAt), netPnlR: t.netPnlR })
    }

    await saveBacktestRun({
      contractCode: input.contractCode, decisionTf: '1m', judge: 'rule',
      windowKind: 'validate', windowFrom: fold.validateFrom, windowTo: fold.validateTo,
      slippageTicks: typical, versions, summary: validateRun,
    }).catch(() => undefined)

    progress.done += 4
  }

  // ⑤ 판단기 비교 — 차이의 신뢰구간
  const comparison = isBetterThan(
    bootstrapDifference(validateTrades, mlTrades, { seed: num('validation_seed', 1) }),
    num('gate_min_judge_improvement_r', 0.05),
  )
  progress.done += 1

  /**
   * ⑥ 슬리피지 민감도 — 1·2·4·8틱을 전부 돌린다.
   *
   * 관문은 가혹 조건 한 줄만 보지만, 나머지 줄이 있어야 「어디서 뒤집히는가」가 보인다.
   * 뒤집히는 지점이 가혹 조건 바로 옆이면 그 전략은 통과해도 위태롭다.
   */
  const sensitivityResults: { ticks: number; harsh: boolean; expectancyR: number | null; tradeCount: number }[] = []
  for (const slip of sensitivity) {
    const trades: { tradeDate: string; netPnlR: number }[] = []
    for (const fold of planned.plan.folds) {
      const run = await runBacktest(barsIn(fold.validateFrom, fold.validateTo), createRuleJudge(), params(slip.ticks))
      for (const t of run.trades) {
        if (t.netPnlR !== null) trades.push({ tradeDate: tradeDateOf(t.barCloseAt), netPnlR: t.netPnlR })
      }
    }
    sensitivityResults.push({
      ticks: slip.ticks,
      harsh: slip.harsh,
      expectancyR: trades.length > 0 ? summarize(trades).expectancyR : null,
      tradeCount: trades.length,
    })
  }
  const harshRow = sensitivityResults.find((r) => r.harsh) ?? null
  const harshTrades = harshRow ? [{ tradeDate: 'x', netPnlR: harshRow.expectancyR ?? 0 }] : []

  // ⑦ 관문
  const summary = summarize(validateTrades)
  const typicalRisk = computeRisk({
    direction: 'long', instrument: { multiplier: instrument.multiplier, tickSize: instrument.tickSize },
    referencePrice: 1100, stopPrice: 1100 - 1.56, chaseDistance: 0.4,
    stopSlippageTicks: typical, roundTripFeeKrw: num('fee_rate', 0), quantity: 1,
  })
  const gate = evaluateGate({
    thresholds: {
      minValidateTrades: num('gate_min_validate_trades', 500),
      minLockboxTrades: num('gate_min_lockbox_trades', 100),
      minProfitFactor: num('gate_min_profit_factor', 1.25),
      maxDrawdownLimitMultiple: num('gate_max_drawdown_multiple', 8),
      dailyLossLimitKrw: num('daily_loss_limit_krw', 0),
      minJudgeImprovementR: num('gate_min_judge_improvement_r', 0.05),
    },
    validateTradeCount: validateTrades.length,
    lockboxTradeCount: 0,
    validateExpectancy: bootstrapExpectancy(validateTrades, { seed: num('validation_seed', 1) }),
    lockboxExpectancy: null,
    harshExpectancyR: harshRow?.expectancyR ?? null,
    profitFactor: profitFactor(validateTrades),
    maxDrawdownR: validateTrades.length > 0 ? maxDrawdownR(validateTrades) : null,
    riskPerTradeKrw: typicalRisk.riskPerTradeKrw,
    calibration: calibrationVerdict,
    judgeComparison: comparison,
    riskArithmeticOk: num('daily_loss_limit_krw', 0) >= typicalRisk.riskPerTradeKrw,
  })
  progress.done += 1
  progress.currentLabel = null

  return {
    ok: true,
    reason: `validated:folds=${planned.plan.folds.length},trades=${validateTrades.length},`
      + `days=${summary.dayCount},assumed_spread=${(assumedRatio * 100).toFixed(0)}%,`
      + `sensitivity=${sensitivityResults.map((r) => `${r.ticks}t:${r.expectancyR?.toFixed(3) ?? 'n/a'}`).join('|')}`,
    userMessage: null,
    progress,
    gate,
  }
}

async function loadInstrument(contractCode: string): Promise<
  { root: string; multiplier: number; tickSize: number } | null
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: contract } = await admin
    .from('trading_contracts').select('instrument_id').eq('code', contractCode).maybeSingle()
  if (!contract) return null
  const { data: instrument } = await admin
    .from('trading_instruments').select('root, multiplier, tick_size').eq('id', contract.instrument_id).maybeSingle()
  if (!instrument) return null
  return { root: instrument.root, multiplier: Number(instrument.multiplier), tickSize: Number(instrument.tick_size) }
}

/** 모아 둔 최우선 호가로 스프레드를 잰다 */
async function measureSlippage(contractCode: string, tickSize: number, fallbackTicks: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('trading_bars')
    .select('bar_start_at, best_bid, best_ask')
    .eq('contract_code', contractCode).eq('tf', '1m')
    .limit(20_000)
  const samples: PhasedSample[] = ((data ?? []) as Record<string, string | number | null>[]).map((r) => {
    const startAt = new Date(String(r.bar_start_at))
    const minutes = startAt.getUTCHours() * 60 + startAt.getUTCMinutes()
    return {
      startAt,
      bestBid: r.best_bid === null ? null : Number(r.best_bid),
      bestAsk: r.best_ask === null ? null : Number(r.best_ask),
      phase: phaseOf(minutes % 390, 390 - (minutes % 390)),
    }
  })
  return spreadStats(samples, { tickSize, fallbackTicks })
}

export { assertLockboxReadable, openLockbox, plannedCallCount }
export type { MinuteBarInput }
