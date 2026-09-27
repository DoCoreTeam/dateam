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
import { sendPush } from './web-push.ts'
import { listSubscriptions, loadVapidKeys, deleteSubscription, recordSubscriptionOutcome } from './push-store.ts'

export interface QueueInput {
  /** 신호에 딸린 알림이면 그 신호. 손절 확인·증거금 경고처럼 신호가 없으면 null */
  signalId: string | null
  kind: NotifyKind
  title: string
  body: string
  /**
   * 무엇을 하나로 볼 것인가 (§14.3).
   *
   * 없으면 `<신호 ID>:<종류>` 를 쓴다. **신호가 없으면 반드시 줘야 한다** —
   * `signal_id` 가 NULL 이면 Postgres 에서 유일 키가 아무것도 안 막고,
   * 매분 도는 크론이 같은 경고를 하루 390번 넣는다.
   */
  dedupeKey?: string
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
    const dedupeKey = input.dedupeKey ?? (input.signalId ? `${input.signalId}:${input.kind}` : null)
    if (!dedupeKey) {
      return { queued: false, reason: 'error', detail: 'no_dedupe_key' }
    }
    const { data, error } = await admin.from('trading_notifications').insert({
      signal_id: input.signalId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      dedupe_key: dedupeKey,
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

/**
 * 최근 알림 — 최신 것 먼저. SG-06 이 연속 실패를 셀 자료다.
 *
 * `sent` 를 빼지 않는다 — 연속 실패는 성공을 만나면 멈추는 수라, 성공을 안 읽으면
 * 한 달 전 실패가 오늘까지 이어진 것으로 세어진다.
 */
export async function recentNotifications(limit = 20): Promise<OutboxRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_notifications')
    .select('id, kind, status, attempts, queued_at, last_attempt_at')
    .order('queued_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`알림 기록을 읽지 못했습니다: ${error.message}`)
  return ((data ?? []) as RawRow[]).map(toRow)
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

/** 대기 행의 본문. 정책은 `OutboxRow` 만 보고, 보내는 데는 이 값이 더 필요하다 */
interface OutboxContent {
  title: string
  body: string
  signalId: string | null
}

async function loadContents(ids: readonly string[]): Promise<Map<string, OutboxContent>> {
  if (ids.length === 0) return new Map()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_notifications').select('id, title, body, signal_id').in('id', [...ids])
  if (error) throw new Error(`알림 본문을 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Map(((data ?? []) as any[]).map((r) => [r.id as string, {
    title: String(r.title ?? '알림'),
    body: String(r.body ?? ''),
    signalId: (r.signal_id as string | null) ?? null,
  }]))
}

/** 급한 것은 사용자가 지울 때까지 화면에 남는다 (§10.2 우선순위 앞의 셋) */
const URGENT_KINDS = new Set<NotifyKind>(['protection_breached', 'safety', 'daily_limit'])

export interface FlushResult {
  sent: number
  failed: number
  /**
   * 왜 그렇게 됐나. **「0건 보냄」만 돌려주면 고장과 구분되지 않는다** —
   * 보낼 것이 없었는지, 받을 기기가 없었는지, 열쇠가 없었는지가 다 다른 일이다.
   */
  reason: string
}

/**
 * 대기 표를 비운다 — **실제로 기기로 보낸다.**
 *
 * 전에는 이 함수가 행을 `sent` 로 적기만 했다. 그 말은 신호가 났는데 사람에게는
 * 아무 일도 안 일어난다는 뜻이고, 화면을 안 보고 있으면 그 신호는 지나간다.
 *
 * 규율 셋:
 *   ① 받을 기기가 0대면 **「보냈다」로 안 적는다.** 조용한 성공은 고장을 감춘다
 *   ② 404·410 은 그 기기를 지운다. 죽은 주소에 영원히 재시도하지 않는다
 *   ③ 한 대라도 성공하면 그 알림은 나간 것이다. 남은 기기의 실패는 기기 쪽에 적는다
 */
export async function flushNotifications(now: Date): Promise<FlushResult> {
  const rows = await pendingNotifications(now)
  const due = rows.filter((row) => decideSend(row, now).send)
  if (due.length === 0) return { sent: 0, failed: 0, reason: 'notify=nothing_due' }

  const keys = await loadVapidKeys()
  if (!keys) {
    // 보낼 수 없다는 것을 **행에 적는다.** 안 적으면 다음 실행이 같은 것을 또 집고
    // 화면에는 「대기 중」만 쌓인다
    for (const row of due) {
      await recordAttempt(row, { ok: false, error: 'no_push_key' }, now).catch(() => {})
    }
    return { sent: 0, failed: due.length, reason: `notify=no_push_key:${due.length}` }
  }

  const devices = await listSubscriptions()
  if (devices.length === 0) {
    for (const row of due) {
      await recordAttempt(row, { ok: false, error: 'no_subscription' }, now).catch(() => {})
    }
    return { sent: 0, failed: due.length, reason: `notify=no_device:${due.length}` }
  }

  const contents = await loadContents(due.map((r) => r.id))
  let sent = 0
  let failed = 0
  let removed = 0

  for (const row of due) {
    const content = contents.get(row.id)
    if (!content) {
      failed += 1
      await recordAttempt(row, { ok: false, error: 'content_missing' }, now).catch(() => {})
      continue
    }
    let anyOk = false
    let lastError = 'no_device'
    for (const device of devices) {
      const result = await sendPush({
        target: { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
        payload: {
          title: content.title,
          body: content.body,
          url: content.signalId ? `/trading?signal=${content.signalId}` : '/trading',
          tag: row.kind,
          urgent: URGENT_KINDS.has(row.kind),
        },
        keys,
        now,
      })
      if (result.ok) {
        anyOk = true
        await recordSubscriptionOutcome(device.endpoint, { ok: true }, now).catch(() => {})
        continue
      }
      lastError = result.reason
      if (result.gone) {
        await deleteSubscription(device.endpoint).catch(() => {})
        removed += 1
        continue
      }
      await recordSubscriptionOutcome(device.endpoint, { ok: false, error: result.reason }, now).catch(() => {})
    }

    try {
      if (anyOk) { await recordAttempt(row, { ok: true }, now); sent += 1 }
      else { await recordAttempt(row, { ok: false, error: lastError }, now); failed += 1 }
    } catch {
      // 결과조차 못 적었다. 행은 그대로 남아 다음 실행이 다시 집는다
      failed += 1
    }
  }

  const note = [`sent=${sent}`, `failed=${failed}`, `devices=${devices.length}`]
  if (removed > 0) note.push(`removed=${removed}`)
  return { sent, failed, reason: `notify=${note.join(',')}` }
}
