/**
 * 알림 아웃박스 정책 — **보내기 전에 적는다** (§14.3 · D-33)
 *
 * ## 왜 바로 안 보내나
 *
 * 크론이 겹쳐 두 실행이 같은 신호를 보면 알림이 두 번 간다. 유일 키를 신호에만 걸어도
 * 막히지 않는다 — 저장은 한 번이어도 **보내는 일은 표 밖에서 일어나기 때문이다.**
 * 그래서 보낼 것을 먼저 대기 표에 유일 키 `(신호 ID, 알림 종류)` 로 넣고,
 * **넣는 데 성공한 실행만** 보낸다. 다른 실행은 유일 키에 걸려 아무것도 안 보낸다.
 *
 * ## 왜 실패해도 안 지우나
 *
 * 발송이 실패했을 때 행을 지우면 「알림이 안 왔다」와 「알림이 없었다」가 똑같아진다.
 * 사람은 신호가 없었다고 믿고 넘어간다. 그래서 행은 남고, 왜 못 보냈는지가 남고,
 * 다음 실행이 집는다. 다 쓴 뒤에도 남는다 — 그것이 SG-06 이 세는 자료다.
 */

/** 알림 종류. DB 검사 제약과 같은 목록이다 */
export const NOTIFY_KINDS = [
  'signal', 'exit', 'safety', 'daily_limit', 'session_close', 'protection_breached',
] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]

export type NotifyStatus = 'pending' | 'sent' | 'failed'

/**
 * 급한 순서. 숫자가 작을수록 먼저 나간다.
 *
 * 손절가를 지났는데 포지션이 남은 것(`protection_breached`)이 맨 앞이다 —
 * 그 순간에 오는 신호 알림은 사람을 더 위험하게 만든다(§11).
 */
export const KIND_PRIORITY: Record<NotifyKind, number> = {
  protection_breached: 0,
  safety: 1,
  daily_limit: 2,
  session_close: 3,
  exit: 4,
  signal: 5,
}

/** 몇 번까지 다시 보내나. 넘으면 그만 보내되 **행은 남는다** */
export const MAX_ATTEMPTS = 5

/** 시도 횟수별 다음 시도까지 기다릴 초. 마지막 값을 넘으면 마지막 값 */
export const BACKOFF_SECONDS = [0, 30, 120, 600, 1800] as const

export function backoffSecondsFor(attempts: number): number {
  if (attempts <= 0) return BACKOFF_SECONDS[0]
  return BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)]
}

export interface OutboxRow {
  id: string
  kind: NotifyKind
  status: NotifyStatus
  attempts: number
  queuedAt: Date
  /** 마지막으로 보내 본 때. 한 번도 안 보냈으면 null */
  lastAttemptAt: Date | null
}

export type SendDecision =
  | { send: true }
  | { send: false; reason: 'already_sent' | 'too_many_attempts' | 'backing_off' }

/**
 * 지금 이것을 보내도 되나.
 *
 * `sent` 는 다시 안 보낸다(§14.3). 상한을 넘은 것도 안 보내지만 **지우지 않는다** —
 * 그 행이 「보내려 했는데 다섯 번 다 실패했다」는 사실이고, SG-06 이 그것을 센다.
 */
export function decideSend(row: OutboxRow, now: Date): SendDecision {
  if (row.status === 'sent') return { send: false, reason: 'already_sent' }
  if (row.attempts >= MAX_ATTEMPTS) return { send: false, reason: 'too_many_attempts' }
  if (row.lastAttemptAt) {
    const waited = (now.getTime() - row.lastAttemptAt.getTime()) / 1000
    if (waited < backoffSecondsFor(row.attempts)) return { send: false, reason: 'backing_off' }
  }
  return { send: true }
}

/**
 * 집어 갈 순서. 급한 것 먼저, 같은 급이면 오래된 것 먼저.
 *
 * 오래된 것을 먼저 보내는 이유: 늦은 알림은 값이 떨어져도 **순서가 뒤집히면 읽는 사람이 헷갈린다.**
 * 청산 알림이 진입 알림보다 먼저 오면 사람은 자기가 뭘 놓쳤는지 모른다.
 */
export function pickOrder(rows: readonly OutboxRow[], now: Date): OutboxRow[] {
  return rows
    .filter((r) => decideSend(r, now).send)
    .slice()
    .sort((a, b) => {
      const p = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
      if (p !== 0) return p
      return a.queuedAt.getTime() - b.queuedAt.getTime()
    })
}

/** 발송 결과를 어떤 행으로 적나 */
export interface AttemptPatch {
  status: NotifyStatus
  attempts: number
  sentAt: Date | null
  /** 성공이든 실패든 **보내 본 때**. 다음 시도 간격을 이 값으로 잰다 */
  lastAttemptAt: Date
  reason: string | null
  userMessage: string | null
}

export function patchAfterSend(row: OutboxRow, now: Date): AttemptPatch {
  return {
    status: 'sent', attempts: row.attempts + 1,
    sentAt: now, lastAttemptAt: now, reason: null, userMessage: null,
  }
}

/**
 * 못 보냈을 때. **행이 남고 사유가 남는다.**
 *
 * 상한을 넘겨도 `failed` 일 뿐 사라지지 않는다. 사람이 「왜 알림이 안 왔나」를 물었을 때
 * 대답할 것이 있어야 한다.
 */
export function patchAfterFailure(row: OutboxRow, error: string, now: Date): AttemptPatch {
  const attempts = row.attempts + 1
  const exhausted = attempts >= MAX_ATTEMPTS
  return {
    status: 'failed',
    attempts,
    sentAt: null,
    lastAttemptAt: now,
    reason: `${error}${exhausted ? ' (재시도 상한)' : ''}`,
    userMessage: exhausted
      ? '알림을 다섯 번 보내려 했지만 모두 실패했습니다. 신호 화면에서 직접 확인해 주세요'
      : '알림을 보내지 못했습니다. 잠시 뒤 다시 시도합니다',
  }
}

/**
 * 신호 없는 알림의 유일 키. 종목·종류·거래일 하나로 본다.
 *
 * 손절 확인이나 증거금 경고는 하루에 한 번이면 충분하다 — 매분 다시 보내면
 * 사람은 그 종류 전체를 무시하게 되고, 그러면 정말 급한 날에도 안 본다.
 */
export function dailyDedupeKey(contractCode: string, kind: NotifyKind, tradeDate: string): string {
  return `${contractCode}:${kind}:${tradeDate}`
}

/** 연속으로 못 보낸 수 (SG-06). 최근 것부터 세고 `sent` 를 만나면 멈춘다 */
export function failureStreak(rows: readonly OutboxRow[]): number {
  let streak = 0
  for (const row of rows) {
    if (row.status === 'sent') break
    if (row.attempts > 0) streak += 1
  }
  return streak
}
