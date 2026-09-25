import 'server-only'

/**
 * Lockbox — 연 기록을 DB 가 지킨다 (명세 §13.3)
 *
 * 유일 키가 이름 하나라 두 번째 INSERT 를 DB 가 거절한다.
 * 사람 기억이 아니라 잠금으로 「한 번만」을 만든다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import {
  canOpenLockbox, canReadLockbox, windowMatches,
  type Actor, type LockboxDecision, type LockboxRecord,
} from './lockbox-policy.ts'

export async function findLockbox(name: string): Promise<LockboxRecord | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_lockbox_opens')
    .select('name, window_from, window_to, opened_at, opened_by, reason')
    .eq('name', name)
    .maybeSingle()
  if (error) throw new Error(`최종 검증 기록을 읽지 못했습니다: ${error.message}`)
  if (!data) return null
  return {
    name: data.name,
    windowFrom: data.window_from,
    windowTo: data.window_to,
    openedAt: data.opened_at,
    openedBy: data.opened_by,
    reason: data.reason,
  }
}

export interface OpenInput {
  name: string
  windowFrom: string
  windowTo: string
  actor: Actor
  reason: string
}

export type OpenResult =
  | { opened: true; record: LockboxRecord }
  | { opened: false; reason: string; userMessage: string }

export async function openLockbox(input: OpenInput): Promise<OpenResult> {
  const existing = await findLockbox(input.name)
  const decision = canOpenLockbox(input.actor, existing, input.reason)
  if (!decision.allowed) {
    return { opened: false, reason: decision.reason, userMessage: decision.userMessage }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_lockbox_opens').insert({
    name: input.name,
    window_from: input.windowFrom,
    window_to: input.windowTo,
    opened_by: input.actor.kind === 'human' ? input.actor.userId : null,
    reason: input.reason,
  })
  if (error) {
    /**
     * 유일 키에 걸렸다 = 같은 순간에 둘이 열려고 했고 하나가 먼저 열었다.
     * **오류가 아니라 거절이다** — 그리고 이미 열린 것은 열린 것이다.
     */
    const now = await findLockbox(input.name)
    return {
      opened: false,
      reason: `already_opened:${now?.openedAt ?? 'unknown'}`,
      userMessage: '최종 검증 구간이 방금 다른 곳에서 열렸습니다. 한 번만 열 수 있습니다',
    }
  }

  const record = await findLockbox(input.name)
  if (!record) throw new Error('최종 검증 구간을 열었는데 기록을 못 읽었습니다')
  return { opened: true, record }
}

/** 읽어도 되나. 열기 전에는 못 읽는다 */
export async function assertLockboxReadable(
  name: string,
  from: string,
  to: string,
): Promise<LockboxDecision> {
  const existing = await findLockbox(name)
  const decision = canReadLockbox(existing)
  if (!decision.allowed) return decision
  if (existing && !windowMatches(existing, from, to)) {
    return {
      allowed: false,
      reason: 'window_changed',
      userMessage: '열어 둔 구간과 다른 구간을 보려 합니다. 그것은 마지막 확인이 아닙니다',
    }
  }
  return { allowed: true }
}
