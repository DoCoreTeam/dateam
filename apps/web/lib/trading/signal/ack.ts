import 'server-only'

/**
 * 신호 확인 쓰기 — 열람 시각과 확인 시각을 적는다 (§14.2)
 *
 * 판정은 `ack-policy.ts` 가 하고 여기는 왕복만 한다.
 * 소유자 확인은 부르는 쪽(서버 액션)이 `tradingAccess()` 한 번으로 한다 —
 * 여기서 또 하면 두 곳이 갈리고, 갈린 결과가 「화면은 열리는데 창구가 403」이다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { decideAck, resultFor, parseStopPrice, type AckAction } from './ack-policy.ts'
import { SIGNAL_RESULTS } from '../position/pnl.ts'

export type AckOutcome =
  | { ok: true }
  | { ok: false; reason: string; userMessage: string }

interface SignalRow {
  id: string
  direction: 'long' | 'short'
  reference_price: number
  result: string | null
  ack_at: string | null
  bar_close_at: string
}

async function readSignal(id: string): Promise<SignalRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_signals')
    .select('id, direction, reference_price, result, ack_at, bar_close_at')
    .eq('id', id)
    .limit(1)
  if (error) throw new Error(`신호를 읽지 못했습니다: ${error.message}`)
  return ((data ?? [])[0] as SignalRow | undefined) ?? null
}

/**
 * 화면에서 처음 본 때를 적는다 (`opened_at`).
 *
 * **한 번만 적는다.** 다시 볼 때마다 갱신하면 「발송에서 열람까지」가 마지막으로 본 때가 되고,
 * 사람이 얼마나 빨리 알아챘나가 사라진다.
 */
export async function markOpened(signalId: string, now: Date): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('trading_signals')
    .update({ opened_at: now.toISOString() })
    .eq('id', signalId)
    .is('opened_at', null)
  if (error) throw new Error(`열람 시각을 적지 못했습니다: ${error.message}`)
}

export interface AckInput {
  signalId: string
  action: AckAction
  /** `stop_reported` 일 때만 쓴다 */
  stopValue?: unknown
  now: Date
  validMinutes: number
}

/** 버튼을 눌렀다. 판정을 지나야 값이 바뀐다 */
export async function applyAck(input: AckInput): Promise<AckOutcome> {
  const row = await readSignal(input.signalId)
  if (!row) return { ok: false, reason: 'not_found', userMessage: '신호를 찾을 수 없습니다' }

  const deadline = Date.parse(row.bar_close_at) + input.validMinutes * 60_000
  const decision = decideAck(input.action, {
    result: SIGNAL_RESULTS.find((r) => r === row.result) ?? null,
    ackedAt: row.ack_at ? new Date(row.ack_at) : null,
    expired: input.now.getTime() > deadline,
  })
  if (!decision.allowed) return { ok: false, reason: decision.reason, userMessage: decision.userMessage }

  const patch: Record<string, unknown> = { ack_at: input.now.toISOString() }

  if (input.action === 'ordered') {
    // 주문 시각만 적는다. **결과는 체결을 봐야 정해진다**(D-32)
    patch.order_at = input.now.toISOString()
  } else if (input.action === 'skipped') {
    patch.result = resultFor('skipped')
  } else {
    const parsed = parseStopPrice({
      direction: row.direction, referencePrice: Number(row.reference_price), value: input.stopValue,
    })
    if (!parsed.ok) return { ok: false, reason: parsed.reason, userMessage: parsed.userMessage }
    patch.user_reported_stop = parsed.stopPrice
    patch.user_reported_at = input.now.toISOString()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_signals').update(patch).eq('id', input.signalId)
  if (error) throw new Error(`확인을 적지 못했습니다: ${error.message}`)
  return { ok: true }
}
