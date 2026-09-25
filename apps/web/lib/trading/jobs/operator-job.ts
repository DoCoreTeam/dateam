import 'server-only'

/**
 * AI 운영자 — 점검하고, 고칠 수 있는 것만 고치고, 나머지는 사람에게 (§16 Release 3)
 *
 * **지식과 같은 맨 뒤다** (§10.2). 포지션 감시·신호보다 먼저 돌면 AI 가 느린 날
 * 그 분의 수집과 판단이 밀리고, 밀린 봉은 다시 안 온다.
 *
 * 한 실행에 점검은 전부 하고 **조치는 하나만** 한다. 여덟을 한 분에 다 고치면
 * 50초를 넘고 다음 분과 겹친다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { loadTradingSettings } from '../settings/store.ts'
import { runChecks, needsAttention, type CheckInput, type CheckResult } from '../operator/checks.ts'
import { remedyFor } from '../operator/remedy-policy.ts'
import { applyRemedy } from '../operator/remedy.ts'
import { handOff } from '../operator/handoff.ts'
import { makeBriefing, briefingsAsOf } from '../operator/briefing.ts'
import {
  decideIntervention, readLevel, interventionKey, levelChangeTiming,
} from '../operator/intervention.ts'
import { nightRunsAllGates, inNightWindow, nightTradeDateOf } from '../calendar/night-signal.ts'
import type { NightTradeDateRule } from '../calendar/session.ts'

export interface OperatorJobInput {
  now: Date
  tradeDate: string
  ownerUserId: string | null
  measurements: Omit<CheckInput, 'thresholds'>
}

export interface OperatorJobResult {
  reason: string
  /** 손볼 것 수 */
  attention: number
}

/** 점검 결과를 적고, 하나를 손보고, 하루 한 번 브리핑한다 */
export async function runOperatorJob(input: OperatorJobInput): Promise<OperatorJobResult> {
  const { values } = await loadTradingSettings(input.tradeDate)
  if (values.operator_enabled !== true) {
    return { reason: 'operator=off', attention: 0 }
  }

  const num = (key: string, fallback: number) => {
    const v = Number(values[key])
    return Number.isFinite(v) ? v : fallback
  }

  /**
   * 야간이어도 게이트를 줄이지 않는다. 판정을 한 곳에서 물어 「야간이니까」가
   * 이 파일에 흩어지지 않게 한다.
   */
  const night = inNightWindow(input.now)
  const gatesAllOn = nightRunsAllGates()
  // 야간 봉은 설정이 정한 거래일에 속한다(§6.3). 집계가 그 날짜를 쓴다
  const tradeDate = night
    ? nightTradeDateOf(input.tradeDate, String(values.night_trade_date_rule ?? 'next') as NightTradeDateRule)
    : input.tradeDate

  const results = runChecks({
    ...input.measurements,
    thresholds: {
      maxMissingBars: num('operator_max_missing_bars', 5),
      maxMinutesSinceRun: num('gate_max_minutes_since_run', 5),
      maxBrokerFailureStreak: num('gate_max_broker_failure_streak', 3),
      maxNotifyFailureStreak: num('gate_max_notify_failure_streak', 3),
      aiBudgetWarnRatio: num('operator_ai_budget_warn_ratio', 0.8),
    },
  })
  await saveChecks(tradeDate, results)

  const attention = needsAttention(results)
  const remedyNote = await remedyOne(tradeDate, attention[0], values, input)
  const briefNote = await briefOnce(tradeDate, results, input)

  return {
    reason: `operator=checked:${results.length},attention:${attention.length}`
      + `${gatesAllOn ? '' : ',GATES_REDUCED'}`
      + `,${remedyNote},${briefNote}`,
    attention: attention.length,
  }
}

/** 점검 결과를 적는다. 같은 날 같은 점검은 하나이므로 덮어쓴다 */
async function saveChecks(tradeDate: string, results: readonly CheckResult[]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_health_checks').upsert(
    results.map((r) => ({
      trade_date: tradeDate,
      check_id: r.id,
      status: r.status,
      reason: r.reason,
      user_message: r.userMessage,
      measured: r.measured,
      checked_at: new Date().toISOString(),
    })),
    { onConflict: 'trade_date,check_id' },
  )
  if (error) throw new Error(`점검을 적지 못했습니다: ${error.message}`)
}

/**
 * 가장 급한 것 하나를 손본다.
 *
 * 개입 수준이 **승인**이면 AI 가 안 하고 사람에게 넘긴다 — 승인 화면을 따로 만들지 않고
 * 기존 업무로 보낸다. 사람이 그 업무를 보고 화면에서 누르면 그때 된다.
 */
async function remedyOne(
  tradeDate: string,
  worst: CheckResult | undefined,
  values: Readonly<Record<string, unknown>>,
  input: OperatorJobInput,
): Promise<string> {
  if (!worst) return 'remedy=none'

  const decision = remedyFor(worst.id, worst.status, worst.userMessage)
  if (!decision) return 'remedy=none'

  if (decision.by === 'ai') {
    const level = readLevel(values[interventionKey(decision.remedy.actionId)])
    const gate = decideIntervention(decision.remedy.actionId, level)
    if (!gate.allowed) {
      return `remedy=blocked:${gate.reason}${await handOffOr(tradeDate, worst, gate.reason, input)}`
    }
    if (gate.needsApproval) {
      // 승인 수준이면 사람에게 넘긴다. 바뀐 수준은 다음 거래일부터다(§15.2)
      const timing = levelChangeTiming()
      return `remedy=needs_approval:${timing.when}${await handOffOr(tradeDate, worst, 'needs_approval', input)}`
    }
    const applied = await applyRemedy({ tradeDate, decision, now: input.now })
    return `remedy=${applied.outcome}`
  }

  return `remedy=human${await handOffOr(tradeDate, worst, decision.why, input)}`
}

/** 사람에게 넘긴다. 소유자를 모르면 못 넘기고 그 사실을 남긴다 */
async function handOffOr(
  tradeDate: string, check: CheckResult, why: string, input: OperatorJobInput,
): Promise<string> {
  if (!input.ownerUserId) return ',handoff=no_owner'
  const r = await handOff({
    tradeDate,
    ownerUserId: input.ownerUserId,
    check,
    actionId: 'hand_off',
    why,
  })
  return r.handed ? ',handoff=done' : `,handoff=${r.reason}`
}

/** 하루 한 번. 이미 있으면 안 만든다 */
async function briefOnce(
  tradeDate: string, results: readonly CheckResult[], input: OperatorJobInput,
): Promise<string> {
  const existing = await briefingsAsOf(input.now, 5)
  if (existing.some((b) => b.tradeDate === tradeDate)) return 'brief=already'

  const counts = {
    checksOk: results.filter((r) => r.status === 'ok').length,
    checksWarn: results.filter((r) => r.status === 'warn').length,
    checksFail: results.filter((r) => r.status === 'fail').length,
    checksUnknown: results.filter((r) => r.status === 'unknown').length,
  }
  const r = await makeBriefing({
    tradeDate,
    barsCollected: input.measurements.actualBars ?? 0,
    judgments: 0,
    signals: 0,
    notificationsSent: 0,
    notificationsPending: input.measurements.pendingNotifications ?? 0,
    ...counts,
    actionsApplied: 0,
    actionsHandedOff: 0,
    realizedPnlKrw: null,
  })
  return r.made ? 'brief=done' : `brief=${r.reason}`
}
