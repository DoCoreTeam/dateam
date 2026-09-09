/**
 * 알림 (설계서 F8)
 *
 * ## 알림이 본 작업을 막으면 안 된다
 *
 * 분석이 끝나고 알림을 보내다 실패하면, 그 실패가 **분석까지 실패로 만든다.**
 * 사용자는 다시 돌리고 비용을 또 낸다. 알림은 곁가지다 —
 * 실패해도 삼키되 **삼킨 사실은 남긴다**(조용히 사라지면 알림이 안 오는 이유를 못 찾는다).
 *
 * ## 끄고 켜기가 없으면 사용자가 전부 끈다
 *
 * 알림 종류가 늘수록 소음이 된다. 종류별로 못 끄면 사용자는 채널 자체를 끊고,
 * 그러면 정말 중요한 알림도 안 간다.
 */

export type NotifyKind =
  /** 분석이 끝났다 */
  | 'analysis_done'
  /** 분석이 실패했다 */
  | 'analysis_failed'
  /** 레이더가 후보를 찾았다 */
  | 'radar_hit'
  /** 이번 달 AI 비용이 상한에 가깝다 */
  | 'budget_warning'
  /** 제안 마감이 다가온다 */
  | 'deadline_soon'
  /** 정정공고가 떴다 */
  | 'amendment'

export const NOTIFY_KINDS: readonly NotifyKind[] = [
  'analysis_done', 'analysis_failed', 'radar_hit', 'budget_warning', 'deadline_soon', 'amendment',
]

/**
 * 기본으로 켜져 있나.
 *
 * 실패와 마감은 기본으로 켠다 — 안 보내면 **사용자가 손해를 본다.**
 * 나머지는 기본으로 켜되 끌 수 있게 둔다.
 */
export const DEFAULT_ENABLED: Record<NotifyKind, boolean> = {
  analysis_done: true,
  analysis_failed: true,
  radar_hit: true,
  budget_warning: true,
  deadline_soon: true,
  amendment: true,
}

/** 이 종류는 꺼도 무시한다 — 끄면 사용자가 손해를 보는 것들 */
export const ALWAYS_ON: readonly NotifyKind[] = ['analysis_failed']

export interface NotifyPrefs {
  userId: string
  /** 종류별 켜고 끄기. 없는 키는 기본값 */
  kinds: Partial<Record<NotifyKind, boolean>>
}

export function isEnabled(kind: NotifyKind, prefs: NotifyPrefs | null): boolean {
  if (ALWAYS_ON.includes(kind)) return true
  const explicit = prefs?.kinds?.[kind]
  return explicit === undefined ? DEFAULT_ENABLED[kind] : explicit
}

export interface Notification {
  orgId: string
  /** null 이면 조직 전체 */
  userId: string | null
  kind: NotifyKind
  title: string
  body: string | null
  link: string | null
}

export interface NotifyInput {
  orgId: string
  kind: NotifyKind
  title: string
  body?: string | null
  link?: string | null
  /** 받을 사람들. 비면 조직 전체 */
  userIds?: readonly string[]
  prefsByUser?: ReadonlyMap<string, NotifyPrefs>
}

/**
 * 보낼 알림 목록을 만든다 — 꺼 둔 사람은 뺀다.
 *
 * 여기서 거르는 이유: DB 에 넣고 화면에서 거르면 **안 볼 알림이 계속 쌓인다.**
 */
export function planNotifications(input: NotifyInput): Notification[] {
  const base = {
    orgId: input.orgId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  }

  if (!input.userIds || input.userIds.length === 0) {
    return [{ ...base, userId: null }]
  }

  return input.userIds
    .filter((id) => isEnabled(input.kind, input.prefsByUser?.get(id) ?? null))
    .map((id) => ({ ...base, userId: id }))
}

export interface NotifyResult {
  sent: number
  /** 삼킨 오류 — 조용히 사라지면 알림이 안 오는 이유를 못 찾는다 */
  error: string | null
}

export type NotifySink = (rows: readonly Notification[]) => Promise<void>

/**
 * 알림을 보낸다. **실패해도 던지지 않는다.**
 *
 * 알림 실패가 분석을 실패로 만들면 사용자는 다시 돌리고 비용을 또 낸다.
 */
export async function notify(input: NotifyInput, sink: NotifySink): Promise<NotifyResult> {
  const rows = planNotifications(input)
  if (rows.length === 0) return { sent: 0, error: null }
  try {
    await sink(rows)
    return { sent: rows.length, error: null }
  } catch (e) {
    // 삼키되 남긴다
    return { sent: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// 자주 쓰는 알림들 — 문구를 여기 모아 두면 화면과 어긋나지 않는다

export function analysisDone(orgId: string, caseTitle: string, caseId: string, userIds?: readonly string[]): NotifyInput {
  return {
    orgId, kind: 'analysis_done', userIds,
    title: `분석이 끝났습니다`,
    body: caseTitle,
    link: `/rfp/cases/${caseId}`,
  }
}

export function analysisFailed(orgId: string, caseTitle: string, caseId: string, reason: string): NotifyInput {
  return {
    orgId, kind: 'analysis_failed',
    title: `분석이 멈췄습니다`,
    body: `${caseTitle} — ${reason}`,
    link: `/rfp/cases/${caseId}`,
  }
}

export function radarHit(orgId: string, count: number): NotifyInput {
  return {
    orgId, kind: 'radar_hit',
    title: `새 공고 후보 ${count}건`,
    body: null,
    link: '/rfp/radar',
  }
}

/** 이 비율을 넘으면 비용 경고를 보낸다 */
export const BUDGET_WARN_RATIO = 0.8

export function budgetWarning(orgId: string, usedKrw: number, limitKrw: number): NotifyInput | null {
  if (limitKrw <= 0) return null
  const ratio = usedKrw / limitKrw
  if (ratio < BUDGET_WARN_RATIO) return null
  return {
    orgId, kind: 'budget_warning',
    title: `이번 달 AI 비용이 한도의 ${Math.round(ratio * 100)}%입니다`,
    body: `${Math.round(usedKrw).toLocaleString()}원 / ${limitKrw.toLocaleString()}원`,
    link: '/rfp/settings',
  }
}

/** 마감 며칠 전에 알릴까 */
export const DEADLINE_WARN_DAYS = 3

export function deadlineSoon(
  orgId: string, caseTitle: string, caseId: string, deadline: string, now: () => number = () => Date.now(),
): NotifyInput | null {
  const days = (Date.parse(deadline) - now()) / 86_400_000
  if (!Number.isFinite(days) || days < 0 || days > DEADLINE_WARN_DAYS) return null
  return {
    orgId, kind: 'deadline_soon',
    title: `제안 마감 D-${Math.ceil(days)}`,
    body: caseTitle,
    link: `/rfp/cases/${caseId}`,
  }
}
