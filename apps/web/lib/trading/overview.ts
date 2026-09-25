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
import { loadSessionWindow } from './calendar/seed.ts'
import type { DayCoverage, JudgmentRow, RunRow, TradingOverview } from './overview-shape.ts'

export type { DayCoverage, JudgmentRow, RunRow, TradingOverview } from './overview-shape.ts'
export { isDayComplete, missingCount } from './overview-shape.ts'

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

  const days: string[] = []
  for (let i = LOOKBACK_DAYS - 1; i >= 0; i -= 1) days.push(addKstDays(today, -i))

  const coverage: DayCoverage[] = []
  for (const tradeDate of days) {
    const window = await loadSessionWindow(tradeDate)
    if (!window || !contractCode) {
      coverage.push({ tradeDate, expected: 0, actual: 0, unknown: true })
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
    coverage.push({ tradeDate, expected, actual: count ?? 0, unknown: false })
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

  return {
    contractCode,
    coverage,
    judgments,
    recentRuns,
    empty: coverage.every((d) => d.actual === 0) && judgments.length === 0,
  }
}
