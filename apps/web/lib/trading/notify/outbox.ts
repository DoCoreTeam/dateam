import 'server-only'

/**
 * 알림 아웃박스 — 대기 표에 넣고, 넣은 실행만 보낸다 (§14.3 · D-33)
 *
 * 여기 있는 것은 DB 왕복뿐이다. 「보낼까 말까」와 「어느 것부터」는
 * `outbox-policy.ts` 의 순수 함수가 정하고 시험이 지킨다.
 *
 * ## 곁가지가 본 일을 죽이지 않는다
 *
 * `queueNotification` 이 실패해도 던지지 않는다. 신호는 이미 저장됐고,
 * 알림을 못 넣었다고 신호까지 없던 일로 만들면 사람은 **신호가 없었다고 믿는다.**
 * 대신 실패한 사실을 돌려주고 부른 쪽이 기록한다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import {
  decideSend, pickOrder, patchAfterSend, patchAfterFailure,
  type NotifyKind, type OutboxRow,
} from './outbox-policy.ts'

export interface QueueInput {
  signalId: string
  kind: NotifyKind
  title: string
  body: string
}

export type QueueResult =
  | { queued: true; notificationId: string }
  /** 이미 있다 — 다른 실행이 먼저 넣었다. 이 실행은 **보내지 않는다** */
  | { queued: false; reason: 'already_queued' }
  | { queued: false; reason: 'error'; detail: string }

/**
 * 대기 표에 넣는다. **넣는 데 성공한 실행만** 보낼 자격이 있다(D-33).
 *
 * 유일 키에 걸리면 오류가 아니다 — 크론이 겹쳤다는 뜻이고, 그것이 이 표의 목적이다.
 */
export async function queueNotification(input: QueueInput): Promise<QueueResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin.from('trading_notifications').insert({
      signal_id: input.signalId,
      kind: input.kind,
      title: input.title,
      body: input.body,
    }).select('id')

    if (error) {
      if (error.code === '23505' || /duplicate key/i.test(error.message)) {
        return { queued: false, reason: 'already_queued' }
      }
      return { queued: false, reason: 'error', detail: error.message }
    }
    const id = (data ?? [])[0]?.id as string | undefined
    if (!id) return { queued: false, reason: 'error', detail: 'no_id_returned' }
    return { queued: true, notificationId: id }
  } catch (err) {
    return { queued: false, reason: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}

interface RawRow {
  id: string
  kind: NotifyKind
  status: 'pending' | 'sent' | 'failed'
  attempts: number
  queued_at: string
  last_attempt_at: string | null
}

function toRow(raw: RawRow): OutboxRow {
  return {
    id: raw.id,
    kind: raw.kind,
    status: raw.status,
    attempts: raw.attempts,
    queuedAt: new Date(raw.queued_at),
    lastAttemptAt: raw.last_attempt_at ? new Date(raw.last_attempt_at) : null,
  }
}

/** 아직 안 보낸 것을 집는다. `sent` 는 아예 안 읽는다(§14.3) */
export async function pendingNotifications(now: Date, limit = 50): Promise<OutboxRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_notifications')
    .select('id, kind, status, attempts, queued_at, last_attempt_at')
    .neq('status', 'sent')
    .order('queued_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`알림 대기 목록을 읽지 못했습니다: ${error.message}`)
  return pickOrder(((data ?? []) as RawRow[]).map(toRow), now)
}

/** 보낸 뒤 · 못 보낸 뒤 결과를 적는다. **행은 어느 쪽이든 남는다** */
export async function recordAttempt(row: OutboxRow, outcome: { ok: true } | { ok: false; error: string }, now: Date): Promise<void> {
  const patch = outcome.ok ? patchAfterSend(row, now) : patchAfterFailure(row, outcome.error, now)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_notifications').update({
    status: patch.status,
    attempts: patch.attempts,
    sent_at: patch.sentAt?.toISOString() ?? null,
    last_attempt_at: patch.lastAttemptAt.toISOString(),
    reason: patch.reason,
    user_message: patch.userMessage,
  }).eq('id', row.id)
  if (error) throw new Error(`알림 결과를 적지 못했습니다: ${error.message}`)
}

/**
 * 이 저장소에는 푸시 발송 장치가 없다.
 *
 * 그래서 「보낸다」는 대기 표에 넣고 `sent` 로 표시하는 것까지고, 사람은 신호 화면에서 본다.
 * 장치가 생기면 여기만 바꾸면 된다 — 정책과 표는 그대로 쓴다.
 */
export async function flushNotifications(now: Date): Promise<{ sent: number; failed: number }> {
  const rows = await pendingNotifications(now)
  let sent = 0
  let failed = 0
  for (const row of rows) {
    if (!decideSend(row, now).send) continue
    try {
      await recordAttempt(row, { ok: true }, now)
      sent += 1
    } catch (err) {
      failed += 1
      try {
        await recordAttempt(row, { ok: false, error: err instanceof Error ? err.message : String(err) }, now)
      } catch {
        // 결과조차 못 적었다. 행은 그대로 남아 다음 실행이 다시 집는다
      }
    }
  }
  return { sent, failed }
}
