import 'server-only'

/**
 * 백테스트 결과 저장 — **무엇으로 돌렸는지가 같이 남는다** (§14.1)
 *
 * 성적만 남기면 한 달 뒤 「이 0.31R 은 어느 판의 것인가」에 답할 수 없고,
 * 답을 못 하면 그 숫자는 비교에 못 쓴다 — 즉 없는 것과 같다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { BacktestSummary } from './run.ts'
import { ambiguousRatio } from '../replay/execution.ts'

export interface RunVersions {
  specVersion: string
  calibrationVersion: string | null
  evModelVersion: string | null
  executionModelVersion: string
  tradingLogicVersion: string | null
  settingsVersion: number | null
}

export interface SaveRunInput {
  contractCode: string
  decisionTf: string
  judge: 'rule' | 'ml' | 'jev'
  windowKind: 'train' | 'validate' | 'lockbox'
  windowFrom: string
  windowTo: string
  slippageTicks: number
  versions: RunVersions
  summary: BacktestSummary
  /** 없으면 저장은 되고 지표만 빈다 */
  metrics?: { netExpectancyR?: number | null; profitFactor?: number | null; maxDrawdownKrw?: number | null }
}

/** `YYYY-MM-DD` (서울) */
function tradeDateOf(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at)
}

export async function saveBacktestRun(input: SaveRunInput): Promise<{ runId: string; saved: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { data: runRows, error: runError } = await admin
    .from('trading_backtest_runs')
    .insert({
      contract_code: input.contractCode,
      decision_tf: input.decisionTf,
      judge: input.judge,
      window_kind: input.windowKind,
      window_from: input.windowFrom,
      window_to: input.windowTo,
      spec_version: input.versions.specVersion,
      calibration_version: input.versions.calibrationVersion,
      ev_model_version: input.versions.evModelVersion,
      execution_model_version: input.versions.executionModelVersion,
      trading_logic_version: input.versions.tradingLogicVersion,
      settings_version: input.versions.settingsVersion,
      slippage_ticks: input.slippageTicks,
      trade_count: input.summary.trades.length,
      net_expectancy_r: input.metrics?.netExpectancyR ?? null,
      profit_factor: input.metrics?.profitFactor ?? null,
      max_drawdown_krw: input.metrics?.maxDrawdownKrw ?? null,
      ambiguous_bar_ratio: ambiguousRatio(input.summary.trades.map((t) => t.replay)),
      finished_at: new Date().toISOString(),
      reason: `abstained=${input.summary.abstained},no_indicators=${input.summary.skippedForIndicators}`,
    })
    .select('id')

  if (runError) {
    // 유일 키에 걸렸으면 같은 구간·같은 판·같은 틱을 이미 돌린 것이다. 두 번 돌릴 이유가 없다
    if (runError.code === '23505' || /duplicate key/i.test(runError.message)) {
      throw new Error('같은 구간을 같은 판으로 이미 돌렸습니다. 결과를 그대로 보세요')
    }
    throw new Error(`백테스트 결과를 저장하지 못했습니다: ${runError.message}`)
  }

  const runId = (runRows ?? [])[0]?.id as string
  if (!runId) throw new Error('백테스트 실행 id 를 받지 못했습니다')
  if (input.summary.trades.length === 0) return { runId, saved: 0 }

  const rows = input.summary.trades.map((t) => ({
    run_id: runId,
    bar_close_at: t.barCloseAt.toISOString(),
    trade_date: tradeDateOf(t.barCloseAt),
    direction: t.direction,
    trigger_id: t.triggerId,
    raw_score: t.rawScore,
    signal_price: t.signalPrice,
    entry_price: t.replay.entryPrice,
    exit_price: t.replay.exitPrice,
    exit_kind: t.replay.exitKind,
    entry_at: t.replay.entryAt?.toISOString() ?? null,
    exit_at: t.replay.exitAt?.toISOString() ?? null,
    net_pnl_krw: t.replay.filled ? t.replay.netPnlKrw : null,
    net_pnl_r: t.netPnlR,
    cost_krw: t.replay.costKrw,
    ambiguous_bar: t.replay.ambiguousBar,
  }))

  const { error: tradeError } = await admin.from('trading_backtest_trades').insert(rows)
  if (tradeError) throw new Error(`백테스트 거래를 저장하지 못했습니다: ${tradeError.message}`)
  return { runId, saved: rows.length }
}
