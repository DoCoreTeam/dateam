import 'server-only'

/**
 * 지금 들고 있는 것과 오늘 실현 손익.
 *
 * 크론과 **같은 함수**로 접는다(`foldFills`). 화면이 따로 세면 두 숫자가 갈라지고,
 * 갈라진 날 사람은 어느 쪽을 믿어야 할지 모른다.
 */
async function loadHolding(
  contractCode: string | null, today: string,
): Promise<{ holding: HoldingRow | null; dayPnl: DayPnlRow }> {
  if (!contractCode) {
    return { holding: null, dayPnl: { realizedKrw: null, tradeCount: 0, unmeasuredReason: '근월물이 없습니다' } }
  }
  const dayStart = new Date(`${today}T00:00:00+09:00`)
  const dayEnd = new Date(`${today}T23:59:59.999+09:00`)
  try {
    const instrument = await loadInstrumentSpec(today)
    const folded = foldFills(await loadFills(contractCode, dayStart, dayEnd), instrument)
    const plan = folded.open?.signalId ? await loadSignalPlan(folded.open.signalId) : null
    return {
      holding: folded.open
        ? {
          direction: folded.open.direction,
          quantity: folded.open.quantity,
          avgPrice: folded.open.avgPrice,
          openedAt: folded.open.openedAt,
          signalId: folded.open.signalId,
          stopPrice: plan?.stopPrice ?? null,
          targetPrice: plan?.targetPrice ?? null,
        }
        : null,
      dayPnl: {
        realizedKrw: pnlForLimits(dayPnl(folded.closed, null)),
        tradeCount: folded.closed.length,
        unmeasuredReason: '',
      },
    }
  } catch (error) {
    /**
     * 못 읽었으면 **0원이 아니라 모름**이다. 0원은 「오늘 본전」이라는 사실이고,
     * 그것을 보고 사람은 아무 일도 없었다고 읽는다.
     */
    return {
      holding: null,
      dayPnl: {
        realizedKrw: null, tradeCount: 0,
        unmeasuredReason: error instanceof Error ? error.message : '읽지 못했습니다',
      },
    }
  }
}

/**
 * 화면이 볼 것 — **모였나, 빠졌나, 무엇으로 판단했나**
 *
 * 1-A 가 끝났다는 기준은 「5거래일 결측 없는 수집」과 「판단 기록이 봉마다 한 번만」이다.
 * 그 둘을 사람이 눈으로 셀 수 있어야 한다 — 숫자가 안 보이면 「잘 되고 있다」는 짐작이 된다.
 *
 * 창구를 따로 안 만든다. 화면이 서버에서 직접 읽고, 소유자 확인은 레이아웃 한 겹이 한다 —
 * 창구를 열면 그 자리에도 같은 확인을 붙여야 하고, 붙이는 것을 잊으면 조용히 열린다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { addKstDays } from '@/lib/datetime/kst'
import { dateRange } from './calendar/date-range.ts'
import { loadSessionWindow } from './calendar/seed.ts'
import { sameDayExitAt } from './calendar/session.ts'
import { loadTradingSettings } from './settings/store.ts'
import { resolveProviderKey } from '@/lib/ai/provider-key-source'
import type {
  DayCoverage, JudgmentRow, RunRow, SignalRow, LatencyRow, PositionRow, NotifySummary, TradingOverview,
  AccuracySummary,
  HoldingRow, DayPnlRow,
  KnowledgeRow, SettingHelpRow, KnowledgeProgress, OperatorSummary, HealthRow, ArmingSummary,
} from './overview-shape.ts'
import { emitProgressOf, knowledgeProgressOf, jevStatusOf, type JevStatus } from './overview-shape.ts'
import { cardsAsOf } from './knowledge/cards.ts'
import { sourcesAsOf } from './knowledge/sources.ts'
import { reportsAsOf } from './knowledge/pattern.ts'
import { proposalsAsOf } from './knowledge/proposal.ts'
import { explanationsAsOf } from './knowledge/explain.ts'
import { composeHelp } from './knowledge/setting-help.ts'
import {
  INTERVENTION_ITEMS, INTERVENTION_KEY_PREFIX, LEVEL_LABEL, interventionKey, readLevel, autoByDefault,
} from './operator/intervention.ts'
import { ACTION_LABEL } from './operator/remedy-policy.ts'
import { decideToggleNight } from './calendar/night-signal.ts'
import { readArming } from './order/arming.ts'
import { checkArming, armingHint, ARM_CHECK_LABEL, type ArmEnv } from './order/arming-policy.ts'
import { disarmLeavesOrders, wouldDisarm } from './order/disarm-view.ts'
import { ordersToday, unknownOrders } from './order/place.ts'
import { helpTopic } from './knowledge/setting-help-run.ts'
import { TRADING_SETTINGS } from './settings/registry.ts'
import { LATENCY_SEGMENTS, SEGMENT_LABEL, latencyReport, decideResult, dayPnl, pnlForLimits, type SignalTimes } from './position/pnl.ts'
import { PROTECTION_LABEL, needsHumanUnlock, DEFAULT_PROTECTION, type ProtectionState } from './position/state.ts'
import { decideEnableNotify, enableHint } from './notify/enable-gate.ts'
import { evaluateGate, type CriterionResult } from './gate/criteria.ts'
import { loadBarsAsOf } from './bars/store.ts'
import { buildSeries, type ChartSeries, type PlanParams } from './chart/series.ts'
import { scoreJudgment, summarizeScores, type JudgmentScore } from './judge/score.ts'
import { leaningOf } from './judgment-labels.ts'
import { loadFills } from './position/fills.ts'
import { foldFills } from './position/from-fills.ts'
import { loadSignalPlan } from './position/plan.ts'
import { loadInstrumentSpec } from './settings/store.ts'
import { typicalTradeRisk } from './risk/arithmetic.ts'
import { buildGateInput, type BacktestRunRow } from './overview-gate.ts'

export type {
  DayCoverage, JudgmentRow, RunRow, SignalRow, LatencyRow, PositionRow, NotifySummary,
  EmitProgress, TradingOverview, GateSummary, HoldingRow, DayPnlRow,
} from './overview-shape.ts'
export { isDayComplete, missingCount, isSignalActionable } from './overview-shape.ts'

/** 오늘부터 거슬러 며칠을 보나. 1-A 완료 기준이 5거래일이라 주말을 감안해 넉넉히 */
const LOOKBACK_DAYS = 10

function seoulToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}

/**
 * Jev 를 부를 수 있나. **키 값은 안 들고 나온다** — 있는지 없는지만 옮긴다(S3).
 *
 * 못 읽어도 던지지 않는다. 현황 한 줄 때문에 화면 전체가 죽으면 안 되고,
 * 그때는 「모델이 없다」가 아니라 **읽기 실패**를 말해야 하므로 키를 없는 것으로 치지 않는다.
 */
async function loadJevStatus(
  values: Record<string, unknown>,
  /** 오늘 쌓인 AI 판단 건수. 이 화면이 안 부르는 것과 아무도 안 부르는 것을 가른다 */
  aiJudgedToday: number,
): Promise<JevStatus> {
  const model = typeof values.jev_model === 'string' ? values.jev_model : ''
  if (model.trim() === '') return jevStatusOf({ model: '', keyReason: 'no_key', aiJudgedToday })
  try {
    const choice = await resolveProviderKey('jev', null)
    return jevStatusOf({ model, keyReason: choice.reason, aiJudgedToday })
  } catch {
    // 키 표를 못 읽었다. 「키가 없다」로 적으면 멀쩡한 키를 등록하라고 말하게 된다
    return { on: false, reason: 'key_missing', aiJudgedToday }
  }
}

export async function loadTradingOverview(now: Date): Promise<TradingOverview> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const today = seoulToday(now)

  const { data: front, error: contractError } = await admin
    .from('trading_contracts')
    .select('code')
    .eq('is_front', true)
    .limit(1)
  if (contractError) throw new Error(`월물을 읽지 못했습니다: ${contractError.message}`)
  const contractCode = ((front ?? [])[0]?.code as string | undefined) ?? null

  const days = dateRange(addKstDays(today, -(LOOKBACK_DAYS - 1)), today)

  // 청산 여유 분은 설정이다. 화면이 따로 계산하면 만기일에 규칙과 화면이 갈린다
  const { values } = await loadTradingSettings(today)
  const exitMinutes = Number(values.session_close_exit_minutes)
  const exitBefore = Number.isFinite(exitMinutes) ? exitMinutes : 15

  /**
   * 수집이 언제 시작됐나. **첫 크론 실행이 그 답이다** —
   * 그 앞의 빈 날은 「아직 안 모은 날」이 아니라 아무도 안 보고 있던 날이고,
   * 사람이 물을 것이 없다 (실측 2026-09-29: 첫 실행 9/26 01:37, 그 앞 평일 다섯 날).
   */
  const { data: firstRun } = await admin
    .from('trading_job_runs')
    .select('scheduled_minute')
    .order('scheduled_minute', { ascending: true })
    .limit(1)
  const firstRunAt = (firstRun ?? [])[0]?.scheduled_minute as string | undefined
  const collectingSince = firstRunAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(firstRunAt))
    : null

  const coverage: DayCoverage[] = []
  for (const tradeDate of days) {
    const window = await loadSessionWindow(tradeDate)
    if (!window || !contractCode) {
      coverage.push({
        tradeDate, expected: 0, actual: 0, unknown: true, sameDayExitAt: null, collectingSince,
      })
      continue
    }
    const expected = Math.max(
      0,
      Math.round((window.continuousEnd.getTime() - window.continuousStart.getTime()) / 60_000),
    )
    const { count, error } = await admin
      .from('trading_bars')
      .select('bar_start_at', { count: 'exact', head: true })
      .eq('contract_code', contractCode)
      .eq('tf', '1m')
      .gte('bar_start_at', window.continuousStart.toISOString())
      .lt('bar_start_at', window.continuousEnd.toISOString())
    if (error) throw new Error(`봉 수를 세지 못했습니다: ${error.message}`)
    coverage.push({
      tradeDate, expected, actual: count ?? 0, unknown: false,
      sameDayExitAt: sameDayExitAt(window, exitBefore).toISOString(),
      collectingSince,
    })
  }

  const { data: judgmentRows, error: judgmentError } = await admin
    .from('trading_judgments')
    .select('id, contract_code, bar_close_at, judge, status, trigger_id, raw_score, abstain_reason, decision_at')
    .order('bar_close_at', { ascending: false })
    .limit(50)
  if (judgmentError) throw new Error(`판단 기록을 읽지 못했습니다: ${judgmentError.message}`)

  /**
   * 오늘 쌓인 AI 판단 건수. **위 목록에서 세지 않는다** — 그 목록은 화면에 그릴 만큼만
   * 가져온 최근 50줄이라 오늘이 그보다 많으면 적게 센다. 「몇 건 쌓였다」는 사실을
   * 말할 자리에 모자란 수를 적으면 그것도 거짓말이다.
   */
  const { count: aiJudgedCount } = await admin
    .from('trading_judgments')
    .select('id', { count: 'exact', head: true })
    .eq('judge', 'jev')
    .gte('bar_close_at', new Date(`${today}T00:00:00+09:00`).toISOString())
  const aiJudgedToday = Number(aiJudgedCount ?? 0)

  const judgments: JudgmentRow[] = ((judgmentRows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    contractCode: String(row.contract_code),
    barCloseAt: String(row.bar_close_at),
    judge: String(row.judge),
    status: String(row.status),
    triggerId: (row.trigger_id as string | null) ?? null,
    rawScore: (row.raw_score as Record<string, number> | null) ?? null,
    abstainReason: (row.abstain_reason as string | null) ?? null,
    decisionAt: (row.decision_at as string | null) ?? null,
  }))

  const { data: runRows, error: runError } = await admin
    .from('trading_job_runs')
    .select('scheduled_minute, status, reason, user_message')
    .order('scheduled_minute', { ascending: false })
    .limit(20)
  if (runError) throw new Error(`실행 기록을 읽지 못했습니다: ${runError.message}`)

  const recentRuns: RunRow[] = ((runRows ?? []) as Record<string, unknown>[]).map((row) => ({
    scheduledMinute: String(row.scheduled_minute),
    status: String(row.status),
    reason: (row.reason as string | null) ?? null,
    userMessage: (row.user_message as string | null) ?? null,
  }))

  const { data: signalRows, error: signalError } = await admin
    .from('trading_signals')
    .select('id, contract_code, direction, reference_price, stop_price, target_price, bar_close_at,'
      + ' notify_sent_at, opened_at, ack_at, order_at, fill_at, result, user_reported_stop, calibrated_prob,'
      + ' net_expected_value_r')
    .order('bar_close_at', { ascending: false })
    .limit(20)
  if (signalError) throw new Error(`신호를 읽지 못했습니다: ${signalError.message}`)

  const signals: SignalRow[] = ((signalRows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    contractCode: String(row.contract_code),
    direction: row.direction === 'short' ? 'short' : 'long',
    referencePrice: Number(row.reference_price),
    stopPrice: Number(row.stop_price),
    targetPrice: Number(row.target_price),
    barCloseAt: String(row.bar_close_at),
    notifySentAt: (row.notify_sent_at as string | null) ?? null,
    openedAt: (row.opened_at as string | null) ?? null,
    ackAt: (row.ack_at as string | null) ?? null,
    orderAt: (row.order_at as string | null) ?? null,
    fillAt: (row.fill_at as string | null) ?? null,
    result: (row.result as string | null) ?? null,
    userReportedStop: row.user_reported_stop === null || row.user_reported_stop === undefined
      ? null : Number(row.user_reported_stop),
    calibratedProb: row.calibrated_prob === null || row.calibrated_prob === undefined
      ? null : Number(row.calibrated_prob),
    // 못 쟀으면 null 이다. 0 으로 채우면 「본전이 기대된다」는 사실이 되어 버린다
    netExpectedValueR: row.net_expected_value_r === null || row.net_expected_value_r === undefined
      ? null : Number(row.net_expected_value_r),
  }))

  /**
   * 관문 판정. 백테스트를 아직 안 돌렸으면 **전부 「아직 못 잼」** 이 나온다 —
   * 그것이 지금 상태의 정확한 이름이다. 「미달」로 말하면 전략이 나쁜 것으로 읽힌다.
   */
  const { data: runRows2, error: runErr } = await admin
    .from('trading_backtest_runs')
    .select('window_kind, trade_count, net_expectancy_r, profit_factor, max_drawdown_krw')
    .order('started_at', { ascending: false })
    .limit(50)
  if (runErr) throw new Error(`백테스트 결과를 읽지 못했습니다: ${runErr.message}`)
  const runs = (runRows2 ?? []) as unknown as BacktestRunRow[]

  /**
   * 한 거래에 걸리는 돈. **밤에 도는 검증과 같은 함수로 잰다** —
   * 화면이 따로 세면 같은 관문이 낮과 밤에 다른 답을 낸다.
   * 상품 규격을 못 읽으면 못 잰 것이고, 0 으로 채우지 않는다.
   */
  let typicalRiskKrw: number | null = null
  try {
    const instrument = await loadInstrumentSpec(today)
    typicalRiskKrw = typicalTradeRisk({
      instrument,
      stopAtrMultiple: Number(values.exit_stop_atr_multiple) || 1.2,
      chaseAtrMultiple: Number(values.exit_chase_atr_multiple) || 0.3,
      stopSlippageTicks: Number(values.replay_fallback_ticks) || 2,
      roundTripFeeKrw: Number(values.fee_rate) || 0,
    }).riskPerTradeKrw
  } catch {
    /* 규격을 못 읽으면 리스크 산술은 「아직 못 잼」이다 — 화면 전체를 막지는 않는다 */
  }

  const gateVerdict = evaluateGate(buildGateInput({
    runs,
    thresholds: {
      minValidateTrades: Number(values.gate_min_validate_trades) || 500,
      minLockboxTrades: Number(values.gate_min_lockbox_trades) || 100,
      minProfitFactor: Number(values.gate_min_profit_factor) || 1.25,
      maxDrawdownLimitMultiple: Number(values.gate_max_drawdown_multiple) || 8,
      dailyLossLimitKrw: Number(values.daily_loss_limit_krw) || 0,
      minJudgeImprovementR: Number(values.gate_min_judge_improvement_r) || 0.05,
    },
    typicalRiskKrw,
  }))

  /**
   * 네 구간 지연 (§14.2).
   *
   * 결과가 정해진 신호만 센다 — 아직 진행 중인 신호를 넣으면 「아직 안 일어난 일」이
   * 못 잼으로 세어지고, 못 잼 건수가 늘 커 보인다.
   */
  const times: SignalTimes[] = signals.map((row) => ({
    barCloseAt: new Date(row.barCloseAt),
    notifySentAt: row.notifySentAt ? new Date(row.notifySentAt) : null,
    openedAt: row.openedAt ? new Date(row.openedAt) : null,
    orderAt: row.orderAt ? new Date(row.orderAt) : null,
    fillAt: row.fillAt ? new Date(row.fillAt) : null,
  }))
  const validMinutes = Number(values.signal_valid_minutes) || 10
  const settled = times.filter((t, i) => decideResult({
    times: t, validMinutes, skipped: signals[i].result === 'skipped', now,
  }) !== null)
  const report = latencyReport(settled)
  const latency: LatencyRow[] = LATENCY_SEGMENTS.map((segment) => ({
    segment,
    label: SEGMENT_LABEL[segment],
    ...report[segment],
  }))

  const { data: positionRows, error: positionError } = await admin
    .from('trading_position_events')
    .select('position_state, protection_state, reason, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(1)
  if (positionError) throw new Error(`포지션 기록을 읽지 못했습니다: ${positionError.message}`)
  const latest = (positionRows ?? [])[0] as Record<string, string> | undefined
  const position: PositionRow | null = latest
    ? {
        positionState: latest.position_state,
        protectionState: latest.protection_state,
        protectionLabel: PROTECTION_LABEL[(latest.protection_state as ProtectionState) ?? DEFAULT_PROTECTION]
          ?? PROTECTION_LABEL[DEFAULT_PROTECTION],
        reason: latest.reason,
        occurredAt: latest.occurred_at,
        needsHumanUnlock: needsHumanUnlock(latest.position_state as never),
      }
    : null

  /**
   * 알림을 켤 수 있나 (C4).
   *
   * 섀도 거래일은 「신호가 실제로 난 날 수」다 — 크론이 돈 날이 아니다.
   * 돌기만 하고 아무것도 안 난 날을 세면 5일이 하루 만에 찬다.
   */
  const shadowTradeDays = new Set(
    signals.map((s) => s.barCloseAt.slice(0, 10)),
  ).size
  const requiredShadowDays = Number(values.notify_shadow_days_required) || 5
  const notifyCtx = {
    gatePassed: gateVerdict.passed,
    gateInsufficientCount: gateVerdict.insufficientCount,
    gateFailedCount: gateVerdict.failedCount,
    shadowTradeDays,
    requiredShadowDays,
    currentlyEnabled: values.notify_enabled === true,
  }
  const notify: NotifySummary = {
    enabled: notifyCtx.currentlyEnabled,
    canEnable: decideEnableNotify({ kind: 'human', userId: 'preview' }, notifyCtx).allowed,
    hint: enableHint(notifyCtx),
    shadowTradeDays,
    requiredShadowDays,
  }

  return {
    contractCode,
    coverage,
    judgments,
    recentRuns,
    signals,
    latency,
    position,
    ...(await loadHolding(contractCode, today)),
    notify,
    emitProgress: emitProgressOf(recentRuns[0]?.reason ?? null),
    jev: await loadJevStatus(values, aiJudgedToday),
    knowledge: await loadKnowledge(now),
    settingHelp: await loadSettingHelp(now),
    knowledgeProgress: knowledgeProgressOf(recentRuns[0]?.reason ?? null),
    operator: await loadOperator(now, today, values, gateVerdict),
    arming: await loadArming(now, today, values, gateVerdict),
    gate: {
      passed: gateVerdict.passed,
      failedCount: gateVerdict.failedCount,
      insufficientCount: gateVerdict.insufficientCount,
    },
    gateCriteria: gateVerdict.criteria,
    accuracy: await loadAccuracy(contractCode, now, values, today, exitBefore),
    chart: await loadChart(
      contractCode, now, signals, judgments, recentRuns[0]?.reason ?? null,
      // 당일 청산 시각은 오늘 세션이 정한다. 만기일은 15:05, 평일은 15:20 이라 날마다 다르다
      planParamsOf(values, coverage.find((d) => d.tradeDate === today)?.sameDayExitAt ?? null),
    ),
    empty: coverage.every((d) => d.actual === 0) && judgments.length === 0 && signals.length === 0,
  }
}

/**
 * 채점에 쓸 봉 수 — **차트보다 넉넉히 읽는다.**
 *
 * 판단이 난 뒤 결판이 날 때까지의 봉이 있어야 채점이 되고, 앞으로는 지표를 구할 만큼
 * 더 필요하다. 차트용 180봉으로 재면 오래된 판단이 죄다 「아직」으로 잡힌다.
 */
const SCORE_BARS = 3_000

/**
 * 그동안 얼마나 맞았고 **얼마를 벌었나**.
 *
 * 채점은 `judge/score.ts` 가 하고 그 안은 백테스트가 쓰는 `replayExecution` 이다(M4).
 * 여기서는 읽어 오고 묶기만 한다 — 셈을 여기서 또 하면 화면과 검증이 갈린다.
 *
 * 못 읽어도 **던지지 않는다.** 적중률 한 칸 때문에 현황 전체가 죽으면 안 된다.
 */
async function loadAccuracy(
  contractCode: string | null,
  now: Date,
  values: Readonly<Record<string, unknown>>,
  today: string,
  exitBefore: number,
): Promise<AccuracySummary> {
  const baseKrw = Number(values.account_base_krw) || 0
  const feeKrw = Number(values.fee_rate) || 0
  const empty = (reason: string): AccuracySummary => ({
    rows: [], tradeDays: 0, unmeasuredReason: reason,
    contracts: 1, multiplier: 0, baseKrw, feeIncluded: feeKrw > 0,
  })
  if (!contractCode) return empty('근월물이 정해지지 않았습니다')
  try {
    // 승수와 호가 간격은 표가 유일한 출처다(M6). 못 읽으면 못 잰 것이고 기본값을 안 끼운다
    const instrument = await loadInstrumentSpec(today)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const bars = await loadBarsAsOf({ contractCode, tf: '1m', asOf: now, limit: SCORE_BARS })
    if (bars.length === 0) return empty('가격 봉이 아직 없습니다')

    const { data, error } = await admin
      .from('trading_judgments')
      .select('id, bar_close_at, judge, raw_score')
      .eq('status', 'completed')
      .not('raw_score', 'is', null)
      .order('bar_close_at', { ascending: false })
      .limit(2_000)
    if (error) return empty(`판단을 읽지 못했습니다: ${error.message}`)

    const slippage = instrument.tickSize * 2
    const scores: JudgmentScore[] = []
    for (const row of (data ?? []) as { id: string; bar_close_at: string; judge: string; raw_score: Record<string, number> }[]) {
      const lean = leaningOf(row.raw_score)
      // 관망은 채점하지 않는다 — 들어갈 자리가 없으므로 맞고 틀림이 없다
      if (!lean || lean.direction === 'hold') continue
      scores.push(scoreJudgment(
        { id: row.id, barCloseAt: row.bar_close_at, judge: row.judge, direction: lean.direction },
        bars,
        {
          indicators: {
            atrPeriod: Number(values.atr_period) || 14,
            smaFastPeriod: Number(values.sma_fast_period) || 5,
            smaSlowPeriod: Number(values.sma_slow_period) || 20,
            breakoutPeriod: Number(values.breakout_period) || 20,
          },
          exit: {
            stopAtrMultiple: Number(values.exit_stop_atr_multiple) || 1.2,
            targetAtrMultiple: Number(values.exit_target_atr_multiple) || 1.5,
            chaseAtrMultiple: Number(values.exit_chase_atr_multiple) || 0.3,
            timeExitMinutes: Number(values.min_hold_minutes) || 15,
          },
          instrument,
          quantity: 1,
          delayMinutes: Number(values.replay_delay_minutes) || 2,
          orderKind: String(values.replay_order_type ?? 'market') === 'limit' ? 'limit' : 'market',
          slippagePoints: slippage,
          stopSlippagePoints: slippage,
          roundTripFeeKrw: feeKrw,
          // 실시간과 같은 규칙으로 판다 — 그날 접속매매 끝 N분 전
          sessionCloseAt: (barStartAt) => {
            const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(barStartAt)
            return new Date(new Date(`${day}T15:45:00+09:00`).getTime() - exitBefore * 60_000)
          },
        },
      ))
    }
    if (scores.length === 0) return empty('채점할 판단이 아직 없습니다')

    const days = new Set(scores.map((x) => x.barAt.slice(0, 10))).size
    const row = (label: string, list: readonly JudgmentScore[]) => {
      const x = summarizeScores(list)
      return {
        label,
        ...x,
        /*
          **기준금액이 0이면 수익률이 없다.** 0 으로 나누면 무한대고,
          기본값을 지어내면 화면이 사용자가 정하지 않은 수익률을 말하게 된다.
        */
        returnRate: baseKrw > 0 && x.netKrw !== null ? x.netKrw / baseKrw : null,
      }
    }
    return {
      rows: [
        row('전체', scores),
        row('롱', scores.filter((x) => x.direction === 'long')),
        row('숏', scores.filter((x) => x.direction === 'short')),
        row('AI 판단', scores.filter((x) => x.judge === 'jev')),
        row('규칙 판단', scores.filter((x) => x.judge === 'rule')),
      ].filter((r) => r.settled + r.pending + r.unscored > 0),
      tradeDays: days,
      unmeasuredReason: '',
      // 지금은 한 판단에 한 계약이다. 화면이 그 사실을 말해야 원 금액을 읽을 수 있다
      contracts: 1,
      multiplier: instrument.multiplier,
      baseKrw,
      feeIncluded: feeKrw > 0,
    }
  } catch (error) {
    return empty(error instanceof Error ? error.message : '읽지 못했습니다')
  }
}

/**
 * 차트에 실어 보낼 봉 수.
 *
 * **처음 그리는 것보다 넉넉히 보낸다.** 기본 창은 오늘이고(`defaultWindow`), 그 앞은
 * 밀어서 보라고 있는 것이다 — 실측 2026-09-29: 180봉만 보내니 오후에는 그 180봉이
 * 전부 오늘 것이 되어 **밀 자리가 없었다**(좌우로 끌어도 아무 일도 안 일어남).
 *
 * 접속매매 한 판이 390분쯤이라 두 판을 담는다. 봉 하나가 숫자 여섯이라 이 정도는
 * 첫 화면 비용에 얹어도 되는 크기다.
 */
const CHART_BARS = 780

/**
 * 차트 한 벌 — **봉과 신호를 같이 읽는다**
 *
 * 따로 읽으면 화면이 둘을 맞춰야 하고, 맞추는 규칙이 화면마다 달라진다.
 * 창구는 안 연다 — 서버 컴포넌트가 여기로 직접 들어오고 소유자 확인은
 * `(trading)` 레이아웃 한 겹이 이미 하고 있다.
 *
 * 못 읽어도 **던지지 않는다.** 차트 한 칸 때문에 현황 전체가 죽으면
 * 무엇이 막혔는지 볼 자리 자체가 사라진다.
 */
async function loadChart(
  contractCode: string | null,
  now: Date,
  signals: readonly SignalRow[],
  judgments: readonly JudgmentRow[],
  lastRunReason: string | null,
  /** 계획 설정 한 벌. 화면이 배수를 직접 적지 않게 여기서 실어 보낸다 */
  plan: PlanParams,
): Promise<ChartSeries> {
  if (!contractCode) {
    return {
      bars: [], marks: [], calls: [], domain: null, lastBarAt: null,
      blocked: { text: '근월물이 정해지지 않았습니다', tone: 'blocked' },
      window: null, dayBreaks: [],
      planBase: null, planBlocked: '근월물이 정해지지 않았습니다',
    }
  }
  try {
    const bars = await loadBarsAsOf({ contractCode, tf: '1m', asOf: now, limit: CHART_BARS })
    return buildSeries({ bars, signals, judgments, lastRunReason, plan })
  } catch (error) {
    const text = `봉을 읽지 못했습니다: ${error instanceof Error ? error.message : '알 수 없음'}`
    return {
      bars: [], marks: [], calls: [], domain: null, lastBarAt: null,
      blocked: { text, tone: 'blocked' },
      window: null, dayBreaks: [],
      planBase: null, planBlocked: text,
    }
  }
}

/**
 * 계획 설정을 한 벌로 — **기본값을 화면이 아니라 여기서 한 번만 정한다.**
 *
 * `|| 기본값` 을 쓰는 이유는 설정 표의 다른 자리와 같다: 값이 비었거나 숫자가 아니면
 * 레지스트리의 기본값으로 떨어져야 하고, 0 을 넣어 손절 거리를 0 으로 만들면 안 된다.
 */
function planParamsOf(
  values: Readonly<Record<string, unknown>>,
  sameDayExitAt: string | null,
): PlanParams {
  return {
    atrPeriod: Number(values.atr_period) || 14,
    smaFastPeriod: Number(values.sma_fast_period) || 5,
    smaSlowPeriod: Number(values.sma_slow_period) || 20,
    breakoutPeriod: Number(values.breakout_period) || 20,
    stopAtrMultiple: Number(values.exit_stop_atr_multiple) || 1.2,
    targetAtrMultiple: Number(values.exit_target_atr_multiple) || 1.5,
    chaseAtrMultiple: Number(values.exit_chase_atr_multiple) || 0.3,
    timeExitMinutes: Number(values.min_hold_minutes) || 15,
    validMinutes: Number(values.signal_valid_minutes) || 10,
    sameDayExitAt,
  }
}

/**
 * 지금 볼 수 있는 지식 (as-of).
 *
 * 다섯 갈래를 한 목록으로 합친다 — 화면에 표를 다섯 개 두면 사람이 다섯 번 훑어야 하고,
 * 실제로 궁금한 것은 「최근에 무엇이 쌓였나」 하나다.
 *
 * 지식이 안 읽혀도 화면은 서야 한다. 곁가지가 본 일을 죽이지 않는다.
 */
async function loadKnowledge(now: Date): Promise<KnowledgeRow[]> {
  const rows: KnowledgeRow[] = []
  try {
    for (const c of await cardsAsOf(now, 20)) {
      rows.push({
        kind: 'card', id: c.id, title: c.title,
        detail: `${c.topic} · 판 ${c.revision} · 근거 ${c.sources.length}건`,
        availableAt: c.availableAt.toISOString(), needsDecision: false,
      })
    }
    for (const s of await sourcesAsOf(now, 20)) {
      rows.push({
        kind: 'source', id: s.id, title: s.summary ?? s.ref,
        detail: `${s.ref} · ${s.status}${s.reason ? ` · ${s.reason}` : ''}`,
        availableAt: s.availableAt.toISOString(), needsDecision: false,
      })
    }
    for (const r of await reportsAsOf(now, 6)) {
      rows.push({
        kind: 'report', id: r.id, title: `${r.windowFrom} ~ ${r.windowTo} 패턴`,
        detail: `${r.sampleCount}건${r.narrative ? '' : ' · 설명 없음'}`,
        availableAt: r.availableAt.toISOString(), needsDecision: false,
      })
    }
    for (const p of await proposalsAsOf(now, 20)) {
      rows.push({
        kind: 'proposal', id: p.id, title: `${p.settingKey} 변경 제안`,
        detail: `${JSON.stringify(p.currentValue)} → ${JSON.stringify(p.proposedValue)}`
          + ` · ${p.effectiveTradeDate ?? '날짜 미정'}부터 · ${p.rationale}`,
        availableAt: p.availableAt.toISOString(),
        // 대기 중인 것만 사람이 결정한다
        needsDecision: p.status === 'proposed',
      })
    }
    for (const e of await explanationsAsOf(now, 20)) {
      rows.push({
        kind: 'explanation', id: e.signalId, title: '신호 설명',
        detail: e.body, availableAt: e.availableAt.toISOString(), needsDecision: false,
      })
    }
  } catch {
    // 지식을 못 읽어도 화면은 선다. 무엇이 안 읽혔는지는 실행 기록에 남는다
    return rows
  }
  return rows.sort((a, b) => b.availableAt.localeCompare(a.availableAt))
}

/**
 * 설정별 설명. **우리 설명이 늘 먼저다.**
 *
 * 도우미 카드가 있으면 그 아래 붙고, 없으면 우리 설명만 뜬다 —
 * 도우미가 원래 설명을 덮으면 AI 가 죽은 날 화면이 빈다.
 */
async function loadSettingHelp(now: Date): Promise<SettingHelpRow[]> {
  let extraByKey = new Map<string, string>()
  try {
    const cards = await cardsAsOf(now, 200)
    extraByKey = new Map(
      TRADING_SETTINGS
        .map((s) => [s.key, cards.find((c) => c.topic === helpTopic(s.key))?.body])
        .filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
    )
  } catch {
    // 도우미를 못 읽어도 우리 설명은 나간다
    extraByKey = new Map()
  }
  return TRADING_SETTINGS.flatMap((s) => {
    const composed = composeHelp(s.key, extraByKey.get(s.key) ?? null)
    if ('reason' in composed) return []
    return [{ key: composed.key, original: composed.original, extra: composed.extra }]
  })
}

/**
 * AI 운영자 상태.
 *
 * 점검이 안 읽혀도 화면은 선다 — 곁가지가 본 일을 죽이지 않는다.
 */
async function loadOperator(
  now: Date,
  today: string,
  values: Readonly<Record<string, unknown>>,
  gate: { passed: boolean; insufficientCount: number },
): Promise<OperatorSummary> {
  let checks: HealthRow[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data } = await admin
      .from('trading_health_checks')
      .select('check_id, status, user_message, reason')
      .eq('trade_date', today)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    checks = ((data ?? []) as any[]).map((r) => ({
      checkId: String(r.check_id),
      status: String(r.status),
      userMessage: String(r.user_message),
      reason: String(r.reason),
    }))
  } catch {
    checks = []
  }

  /**
   * 개입 수준. 설정 키에 접두사가 붙어 있어 **한 자리에서 다 찾는다** —
   * 화면이 키를 손으로 적으면 항목이 늘 때 그 화면만 옛 목록을 그린다.
   */
  const levels = INTERVENTION_ITEMS.map((item) => {
    const key = interventionKey(item)
    const level = readLevel(values[key])
    return { key, item: ACTION_LABEL[item], level, label: LEVEL_LABEL[level] }
  })
  // 접두사로 찾은 설정과 항목 수가 같아야 한다. 다르면 화면이 일부를 안 그리고,
  // 안 그린 항목은 사람이 못 고친다 — 못 고치는 항목은 기본값으로 남는다
  const declared = Object.keys(values).filter((k) => k.startsWith(INTERVENTION_KEY_PREFIX)).length

  const nightDecision = decideToggleNight(true, {
    nightGatePassed: gate.passed && gate.insufficientCount === 0,
    nightShadowDays: 0,
    requiredShadowDays: Number(values.night_shadow_days_required) || 5,
  })

  return {
    enabled: values.operator_enabled === true,
    attention: checks.filter((c) => c.status !== 'ok').length,
    checks,
    levels,
    autoByDefault: autoByDefault().length > 0,
    levelsOutOfSync: declared !== levels.length,
    night: {
      enabled: values.night_signal_enabled === true,
      canEnable: nightDecision.allowed,
      hint: nightDecision.allowed
        ? '야간 신호를 켤 수 있습니다'
        : nightDecision.userMessage,
    },
  }
}

/**
 * 자동 주문 무장 상태.
 *
 * 못 읽어도 화면은 선다. 그리고 **못 읽으면 해제로 그린다** —
 * 읽기가 실패했을 때 「무장 중」으로 보이면 사람이 안심한다.
 */
async function loadArming(
  now: Date,
  today: string,
  values: Readonly<Record<string, unknown>>,
  gate: { passed: boolean; insufficientCount: number; failedCount: number },
): Promise<ArmingSummary> {
  const env = (String(values.kis_env ?? 'real') === 'paper' ? 'paper' : 'real') as ArmEnv
  const maxOrdersPerDay = Number(values.order_max_per_day) || 12
  const empty: ArmingSummary = {
    env, armed: false, expiresAt: null, canArm: false,
    hint: '무장 상태를 읽지 못했습니다', ordersToday: 0, maxOrdersPerDay, unknownOrders: 0,
    blockedBy: [], disarmLeavesOrders: disarmLeavesOrders(), willDisarm: false,
  }
  try {
    const state = await readArming(env)
    const todayOrders = await ordersToday(
      env,
      new Date(`${today}T00:00:00+09:00`),
      new Date(`${today}T23:59:59+09:00`),
    )
    const decision = checkArming({
      env,
      gatePassed: gate.passed,
      gateInsufficient: gate.insufficientCount,
      notifyEnabled: values.notify_enabled === true,
      paperAutoDays: 0,
      requiredPaperDays: Number(values.order_required_paper_days) || 20,
      reconciliationRequired: false,
      gateFailCount: gate.failedCount,
      riskPerTradeKrw: 0,
      dailyLossLimitKrw: Number(values.daily_loss_limit_krw) || 0,
      paperExpectancyLowerR: null,
    })
    return {
      env,
      armed: state.armed && state.expiresAt.getTime() > now.getTime(),
      expiresAt: state.expiresAt.toISOString(),
      canArm: decision.allowed,
      hint: armingHint(decision),
      ordersToday: todayOrders,
      maxOrdersPerDay,
      unknownOrders: (await unknownOrders(env, 20)).length,
      // 관문 이름을 사람 말로. 코드 이름(A3_paper_days)을 화면에 그대로 내면 못 읽는다
      blockedBy: decision.allowed ? [] : decision.blocks.map((b) => ARM_CHECK_LABEL[b.check]),
      disarmLeavesOrders: disarmLeavesOrders(),
      /**
       * 지금 크론이 돌면 풀리나. **읽기만 한다** — 화면을 여는 것만으로 무장이
       * 풀리면 안 되므로 `wouldDisarm` 은 묻기만 하고 `runOrderJob` 이 실제로 푼다
       */
      willDisarm: wouldDisarm({
        expiresAt: state.expiresAt,
        now,
        ordersToday: todayOrders,
        maxOrdersPerDay,
        orderFailureStreak: 0,
        maxOrderFailureStreak: Number(values.order_max_failure_streak) || 3,
        reconciliationRequired: false,
        protectionBreached: false,
      }),
    }
  } catch {
    return empty
  }
}
