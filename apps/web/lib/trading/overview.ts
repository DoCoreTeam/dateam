import 'server-only'

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
import type {
  DayCoverage, JudgmentRow, RunRow, SignalRow, LatencyRow, PositionRow, NotifySummary, TradingOverview,
  KnowledgeRow, SettingHelpRow, KnowledgeProgress,
} from './overview-shape.ts'
import { emitProgressOf, knowledgeProgressOf } from './overview-shape.ts'
import { cardsAsOf } from './knowledge/cards.ts'
import { sourcesAsOf } from './knowledge/sources.ts'
import { reportsAsOf } from './knowledge/pattern.ts'
import { proposalsAsOf } from './knowledge/proposal.ts'
import { explanationsAsOf } from './knowledge/explain.ts'
import { composeHelp } from './knowledge/setting-help.ts'
import { helpTopic } from './knowledge/setting-help-run.ts'
import { TRADING_SETTINGS } from './settings/registry.ts'
import { LATENCY_SEGMENTS, SEGMENT_LABEL, latencyReport, decideResult, type SignalTimes } from './position/pnl.ts'
import { PROTECTION_LABEL, needsHumanUnlock, DEFAULT_PROTECTION, type ProtectionState } from './position/state.ts'
import { decideEnableNotify, enableHint } from './notify/enable-gate.ts'
import { evaluateGate, type CriterionResult } from './gate/criteria.ts'

export type {
  DayCoverage, JudgmentRow, RunRow, SignalRow, LatencyRow, PositionRow, NotifySummary,
  EmitProgress, TradingOverview, GateSummary,
} from './overview-shape.ts'
export { isDayComplete, missingCount, isSignalActionable } from './overview-shape.ts'

/** 오늘부터 거슬러 며칠을 보나. 1-A 완료 기준이 5거래일이라 주말을 감안해 넉넉히 */
const LOOKBACK_DAYS = 10

function seoulToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
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

  const coverage: DayCoverage[] = []
  for (const tradeDate of days) {
    const window = await loadSessionWindow(tradeDate)
    if (!window || !contractCode) {
      coverage.push({ tradeDate, expected: 0, actual: 0, unknown: true, sameDayExitAt: null })
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
    })
  }

  const { data: judgmentRows, error: judgmentError } = await admin
    .from('trading_judgments')
    .select('id, contract_code, bar_close_at, judge, status, trigger_id, raw_score, abstain_reason, decision_at')
    .order('bar_close_at', { ascending: false })
    .limit(50)
  if (judgmentError) throw new Error(`판단 기록을 읽지 못했습니다: ${judgmentError.message}`)

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
      + ' notify_sent_at, opened_at, ack_at, order_at, fill_at, result, user_reported_stop, calibrated_prob')
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
  const runs = (runRows2 ?? []) as Record<string, number | string | null>[]
  const sumBy = (kind: string) => runs
    .filter((r) => r.window_kind === kind)
    .reduce((acc, r) => acc + Number(r.trade_count ?? 0), 0)

  const gateVerdict = evaluateGate({
    thresholds: {
      minValidateTrades: Number(values.gate_min_validate_trades) || 500,
      minLockboxTrades: Number(values.gate_min_lockbox_trades) || 100,
      minProfitFactor: Number(values.gate_min_profit_factor) || 1.25,
      maxDrawdownLimitMultiple: Number(values.gate_max_drawdown_multiple) || 8,
      dailyLossLimitKrw: Number(values.daily_loss_limit_krw) || 0,
      minJudgeImprovementR: Number(values.gate_min_judge_improvement_r) || 0.05,
    },
    validateTradeCount: sumBy('validate'),
    lockboxTradeCount: sumBy('lockbox'),
    validateExpectancy: null,
    lockboxExpectancy: null,
    harshExpectancyR: null,
    profitFactor: null,
    maxDrawdownR: null,
    riskPerTradeKrw: null,
    calibration: null,
    judgeComparison: null,
    riskArithmeticOk: null,
  })

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
    notify,
    emitProgress: emitProgressOf(recentRuns[0]?.reason ?? null),
    knowledge: await loadKnowledge(now),
    settingHelp: await loadSettingHelp(now),
    knowledgeProgress: knowledgeProgressOf(recentRuns[0]?.reason ?? null),
    gate: {
      passed: gateVerdict.passed,
      failedCount: gateVerdict.failedCount,
      insufficientCount: gateVerdict.insufficientCount,
    },
    gateCriteria: gateVerdict.criteria,
    empty: coverage.every((d) => d.actual === 0) && judgments.length === 0 && signals.length === 0,
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
