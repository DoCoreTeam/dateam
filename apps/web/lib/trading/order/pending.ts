import 'server-only'

/**
 * 주문 한 걸음에 필요한 사실들을 모은다
 *
 * ## 왜 이 파일이 늦게 생겼나
 *
 * Release 4 가 자동 주문을 다 만들어 놓고 크론에서는 **빈 값을 넘기고 있었다**
 * (`acct: null`, `armCtx` 전부 0 과 false, `pendingEntry: null`). 그래서 사람이
 * 화면에서 무장을 켜도 매분 `order=no_account` 로 끝났다. 만든 것과 도는 것은 다른 사실이다.
 *
 * ## 무장은 여기가 안 켠다
 *
 * 이 파일은 **재기만 한다.** 관문 일곱 중 무엇이 막는지는 `checkArming` 이 판정하고,
 * 못 잰 값은 막는 쪽으로 둔다 — 모른다고 통과시키면 그 모름이 곧 허가가 된다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { evaluateGate } from '../gate/criteria.ts'
import { pickPendingEntry, seoulDaysOf, PLACED_STATUSES, BLOCKING_FALLBACK } from './pending-core.ts'
import type { ArmContext, ArmEnv } from './arming-policy.ts'

/** 안전 게이트가 막은 실행을 세는 표식. `blockedSummary` 가 이 꼴로 남긴다 */
export const GATE_BLOCK_MARK = 'safety_gate:'

export interface PendingEntry {
  signalId: string
  contractCode: string
  direction: 'long' | 'short'
}

/**
 * 아직 주문을 안 낸 신호 하나.
 *
 * `trading_orders` 에 같은 신호의 `entry` 가 이미 있으면 안 나온다 — 표의 유일 키가
 * 두 번째 주문을 막지만, 막힌 것을 매분 다시 시도하면 실패가 쌓여 연속 실패로 무장이 풀린다.
 * **막힐 것을 안 내는 것**과 **내고 막히는 것**은 다르다.
 */
export async function loadPendingEntry(
  contractCode: string, from: Date, to: Date,
): Promise<PendingEntry | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_signals')
    .select('id,contract_code,direction,bar_close_at')
    .eq('contract_code', contractCode)
    .gte('bar_close_at', from.toISOString())
    .lt('bar_close_at', to.toISOString())
    .order('bar_close_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(`신호를 읽지 못했습니다: ${error.message}`)
  const signals = (data ?? []) as { id: string; contract_code: string; direction: string }[]
  if (signals.length === 0) return null

  const { data: placed, error: orderError } = await admin
    .from('trading_orders')
    .select('signal_id')
    .eq('order_kind', 'entry')
    .in('signal_id', signals.map((s) => s.id))
  if (orderError) throw new Error(`주문을 읽지 못했습니다: ${orderError.message}`)
  const done = new Set(((placed ?? []) as { signal_id: string }[]).map((r) => r.signal_id))

  const fresh = pickPendingEntry(
    signals.map((s) => ({
      id: s.id,
      contractCode: s.contract_code,
      direction: s.direction === 'short' ? 'short' : 'long',
    })),
    done,
  )
  if (!fresh) return null
  return { signalId: fresh.id, contractCode: fresh.contractCode, direction: fresh.direction }
}

/** 모의로 자동 주문을 돌린 거래일 수 (A3). 주문이 실제로 나간 날만 센다 */
export async function paperAutoDays(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_orders')
    .select('requested_at')
    .eq('env', 'paper')
    // `pending` 은 낼 준비만 한 것이다. 나가지도 않은 날을 실적으로 세지 않는다
    .in('status', [...PLACED_STATUSES])
  if (error) throw new Error(`모의 주문을 세지 못했습니다: ${error.message}`)
  return seoulDaysOf(((data ?? []) as { requested_at: string }[]).map((r) => r.requested_at))
}

/** 오늘 안전 게이트가 막은 실행 수 (A5) */
export async function gateFailCount(jobName: string, from: Date, to: Date): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_job_runs')
    .select('reason')
    .eq('job_name', jobName)
    .gte('scheduled_minute', from.toISOString())
    .lt('scheduled_minute', to.toISOString())
  if (error) throw new Error(`실행 기록을 읽지 못했습니다: ${error.message}`)
  return ((data ?? []) as { reason: string | null }[])
    .filter((r) => (r.reason ?? '').includes(GATE_BLOCK_MARK)).length
}

/** 검증 관문(§13.5) 판정. 화면이 보는 것과 같은 함수를 쓴다 */
export async function loadGateVerdict(
  values: Record<string, unknown>,
): Promise<{ passed: boolean; insufficient: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_backtest_runs')
    .select('window_kind,trade_count')
  if (error) throw new Error(`백테스트 기록을 읽지 못했습니다: ${error.message}`)
  const rows = (data ?? []) as { window_kind: string; trade_count: number | null }[]
  const sumBy = (kind: string) => rows
    .filter((r) => r.window_kind === kind)
    .reduce((acc, r) => acc + Number(r.trade_count ?? 0), 0)
  const num = (key: string, fallback: number) => Number(values[key]) || fallback

  const verdict = evaluateGate({
    thresholds: {
      minValidateTrades: num('gate_min_validate_trades', 500),
      minLockboxTrades: num('gate_min_lockbox_trades', 100),
      minProfitFactor: num('gate_min_profit_factor', 1.25),
      maxDrawdownLimitMultiple: num('gate_max_drawdown_multiple', 8),
      dailyLossLimitKrw: num('daily_loss_limit_krw', 0),
      minJudgeImprovementR: num('gate_min_judge_improvement_r', 0.05),
    },
    validateTradeCount: sumBy('validate'),
    lockboxTradeCount: sumBy('lockbox'),
    /**
     * 아직 안 재는 것들. **null 은 「못 쟀다」이고 관문은 그것을 미달로 센다** —
     * 여기에 0 이나 true 를 넣으면 안 재 보고 통과한다.
     */
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
  return { passed: verdict.passed, insufficient: verdict.insufficientCount }
}

export interface ArmContextInput {
  env: ArmEnv
  jobName: string
  dayStart: Date
  dayEnd: Date
  values: Record<string, unknown>
  reconciliationRequired: boolean
}

/**
 * 관문 일곱이 볼 값을 모은다.
 *
 * **못 읽으면 막는 쪽으로 둔다.** 읽기가 실패했다고 통과시키면 DB 가 흔들리는 날
 * 자동 주문이 열린다 — 그때가 가장 열면 안 되는 때다.
 */
export async function loadArmContext(input: ArmContextInput): Promise<ArmContext> {
  const num = (key: string, fallback: number) => Number(input.values[key]) || fallback
  const [gate, paperDays, gateFails] = await Promise.all([
    loadGateVerdict(input.values).catch(() => BLOCKING_FALLBACK.gate),
    paperAutoDays().catch(() => BLOCKING_FALLBACK.paperAutoDays),
    gateFailCount(input.jobName, input.dayStart, input.dayEnd)
      .catch(() => BLOCKING_FALLBACK.gateFailCount),
  ])
  return {
    env: input.env,
    gatePassed: gate.passed,
    gateInsufficient: gate.insufficient,
    notifyEnabled: input.values.notify_enabled === true || input.values.notify_enabled === 'true',
    paperAutoDays: paperDays,
    requiredPaperDays: num('order_required_paper_days', 20),
    reconciliationRequired: input.reconciliationRequired,
    gateFailCount: gateFails,
    riskPerTradeKrw: num('risk_per_trade_krw', 0),
    dailyLossLimitKrw: num('daily_loss_limit_krw', 0),
    /**
     * 모의 실적의 순손익 하한. **아직 재는 코드가 없다** — 모의 자동 주문이 0일이라
     * 잴 표본 자체가 없기 때문이고, `null` 이면 A7 이 실계좌 무장을 막는다.
     * A3(20거래일)이 먼저 풀리는 날 여기를 채운다.
     */
    paperExpectancyLowerR: null,
  }
}
