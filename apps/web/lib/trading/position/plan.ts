import 'server-only'

/**
 * 들고 있는 포지션의 계획과 보호 상태를 읽는다
 *
 * ## 손절가는 신호에 있다
 *
 * 포지션을 연 체결에는 「얼마에 나올 것인가」가 없다. 그것은 그 체결을 부른 신호에 있다.
 * 신호를 못 찾으면 `null` 이다 — **0 을 쓰지 않는다.** 손절가 0 은 모든 가격이
 * 그것을 지난 것이 되어 매분 손절 이탈 경고가 울린다.
 *
 * ## 보호 상태는 사건 줄에 있다
 *
 * 사람이 「손절 걸었다」고 누른 것이 `trading_position_events` 에 쌓인다.
 * 그 마지막 줄을 안 읽으면 상태가 언제나 `unknown` 이고, 그러면 포지션이 없는 날에도
 * 매일 「손절을 걸었는지 알려 주세요」가 나간다. 물어 봐 놓고 대답을 안 보는 셈이다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { ProtectionState } from './state.ts'

export interface SignalPlan {
  direction: 'long' | 'short'
  stopPrice: number
  targetPrice: number
  timeExitMinutes: number
  sessionCloseAt: Date
  barCloseAt: Date
}

/** 이 신호가 그리던 청산 계획. 못 찾으면 null — 없는 손절가를 만들지 않는다 */
export async function loadSignalPlan(signalId: string): Promise<SignalPlan | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_signals')
    .select('direction,stop_price,target_price,time_exit_minutes,session_close_at,bar_close_at')
    .eq('id', signalId)
    .maybeSingle()
  if (error) throw new Error(`신호를 읽지 못했습니다: ${error.message}`)
  if (!data) return null
  const stop = Number(data.stop_price)
  const target = Number(data.target_price)
  if (!Number.isFinite(stop) || !Number.isFinite(target)) return null
  return {
    direction: data.direction === 'short' ? 'short' : 'long',
    stopPrice: stop,
    targetPrice: target,
    timeExitMinutes: Number(data.time_exit_minutes) || 0,
    sessionCloseAt: new Date(data.session_close_at),
    barCloseAt: new Date(data.bar_close_at),
  }
}

export interface ProtectionRecord {
  state: ProtectionState
  /** 사람이 마지막으로 알려 준 시각. 사람이 누른 줄이 없으면 null */
  reportedAt: Date | null
}

const PROTECTION_VALUES: readonly ProtectionState[] = ['none', 'unknown', 'user_reported', 'breached']

/**
 * 마지막 사건 줄의 보호 상태.
 *
 * 줄이 없으면 **`none`** 이다 — 아직 아무 일도 없었다는 뜻이고,
 * `unknown`(들고 있는데 손절을 걸었는지 모른다)과 다른 사실이다.
 */
export async function loadProtection(contractCode: string): Promise<ProtectionRecord> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_position_events')
    .select('protection_state,occurred_at')
    .eq('contract_code', contractCode)
    .order('occurred_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`보호 상태를 읽지 못했습니다: ${error.message}`)
  const row = (data ?? [])[0] as { protection_state?: string; occurred_at?: string } | undefined
  if (!row) return { state: 'none', reportedAt: null }
  const state = PROTECTION_VALUES.find((v) => v === row.protection_state) ?? 'unknown'
  return {
    state,
    // 「언제 알려 줬나」는 사람이 알려 준 줄에만 있다. 시스템이 적은 줄의 시각이 아니다
    reportedAt: state === 'user_reported' && row.occurred_at ? new Date(row.occurred_at) : null,
  }
}
