import 'server-only'

/**
 * 신호 저장 — **같은 판단에서 두 번 안 나간다** (§14.3)
 *
 * 유일 키가 `(판단 ID, 신호 규칙 판)` 이다. 크론이 두 번 돌아도 신호는 하나다.
 * 규칙 판이 바뀌면 같은 판단에서 새 신호가 날 수 있는데, 그것은 의도다 —
 * 다른 규칙으로 판단한 것은 다른 신호다.
 */

import { createAdminClient } from '@/lib/supabase/server'

export interface SignalRecord {
  judgmentId: string
  contractCode: string
  direction: 'long' | 'short'
  referencePrice: number
  stopPrice: number
  targetPrice: number
  chaseLimitPrice: number
  timeExitMinutes: number
  sessionCloseAt: Date
  calibratedProb: number | null
  netExpectedValueR: number | null
  riskPerTradeKrw: number
  signalRulesVersion: string
  calibrationVersion: string | null
  evModelVersion: string | null
  barCloseAt: Date
}

export type SaveSignalResult =
  | { saved: true; signalId: string }
  | { saved: false; reason: string }

export async function saveSignal(record: SignalRecord): Promise<SaveSignalResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_signals').insert({
    judgment_id: record.judgmentId,
    contract_code: record.contractCode,
    direction: record.direction,
    reference_price: record.referencePrice,
    stop_price: record.stopPrice,
    target_price: record.targetPrice,
    chase_limit_price: record.chaseLimitPrice,
    time_exit_minutes: record.timeExitMinutes,
    session_close_at: record.sessionCloseAt.toISOString(),
    calibrated_prob: record.calibratedProb,
    net_expected_value_r: record.netExpectedValueR,
    risk_per_trade_krw: record.riskPerTradeKrw,
    signal_rules_version: record.signalRulesVersion,
    calibration_version: record.calibrationVersion,
    ev_model_version: record.evModelVersion,
    bar_close_at: record.barCloseAt.toISOString(),
  }).select('id')

  if (error) {
    // 유일 키에 걸렸다 = 이미 난 신호다. 오류가 아니다
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return { saved: false, reason: 'already_emitted' }
    }
    throw new Error(`신호를 저장하지 못했습니다: ${error.message}`)
  }
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) return { saved: false, reason: 'no_id_returned' }
  return { saved: true, signalId: id }
}

/** 오늘 낸 신호 수 (SR-09) */
export async function countSignalsOn(contractCode: string, from: Date, to: Date): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { count, error } = await admin
    .from('trading_signals')
    .select('id', { count: 'exact', head: true })
    .eq('contract_code', contractCode)
    .gte('bar_close_at', from.toISOString())
    .lt('bar_close_at', to.toISOString())
  if (error) throw new Error(`신호 수를 세지 못했습니다: ${error.message}`)
  return count ?? 0
}

/** 같은 방향 마지막 신호 이후 지난 분 (SR-10). 없으면 null */
export async function minutesSinceSameDirection(
  contractCode: string,
  direction: 'long' | 'short',
  now: Date,
): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_signals')
    .select('bar_close_at')
    .eq('contract_code', contractCode)
    .eq('direction', direction)
    .order('bar_close_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`이전 신호를 읽지 못했습니다: ${error.message}`)
  const last = (data ?? [])[0]?.bar_close_at as string | undefined
  if (!last) return null
  return Math.floor((now.getTime() - Date.parse(last)) / 60_000)
}

/** 아무도 안 열어 본 연속 신호 수 (SG-07) */
export async function unopenedSignalStreak(contractCode: string, limit = 20): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_signals')
    .select('opened_at')
    .eq('contract_code', contractCode)
    .order('bar_close_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`신호 열람 기록을 읽지 못했습니다: ${error.message}`)
  let streak = 0
  for (const row of (data ?? []) as { opened_at: string | null }[]) {
    if (row.opened_at) break
    streak += 1
  }
  return streak
}
