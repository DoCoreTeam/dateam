// 부서 업무 순수 유틸 (SSOT) — 서버액션·테스트 공용. server-only import 금지(테스트 가능).
import type { DailyLogEntryType, DeptTaskChecklistItem } from '@/types/database'

/** 부서업무에 허용되는 상태값 ('note' 제외) */
export const DEPT_TASK_STATUSES: DailyLogEntryType[] = ['planned', 'doing', 'blocker', 'done']

export function isDeptTaskStatus(s: string): s is DailyLogEntryType {
  return (DEPT_TASK_STATUSES as string[]).includes(s)
}

/** 진행률 0~100 정수로 정규화. 범위 밖이면 null(거부) */
export function normalizeProgress(value: number): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  if (value < 0 || value > 100) return null
  return Math.round(value)
}

/** 체크리스트 정규화: 비문자열 라벨 제거, 최대 50개, 라벨 500자 컷, done Boolean 강제 */
export function sanitizeChecklist(items: DeptTaskChecklistItem[] | undefined): DeptTaskChecklistItem[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((it) => it && typeof it.label === 'string')
    .slice(0, 50)
    .map((it) => ({ label: it.label.trim().slice(0, 500), done: Boolean(it.done) }))
}

/**
 * 진행률 산출 (C 하이브리드 SSOT):
 * - 상태가 'done'이면 100 강제
 * - 체크리스트가 있으면 done 비율 자동 산출 (수동값 무시)
 * - 체크리스트가 없으면 수동값(manual) 사용, 없으면 0
 */
export function computeProgress(
  checklist: DeptTaskChecklistItem[] | undefined,
  status: DailyLogEntryType,
  manual?: number,
): number {
  if (status === 'done') return 100
  const list = Array.isArray(checklist) ? checklist : []
  if (list.length > 0) {
    const done = list.filter((c) => c.done).length
    return Math.round((done / list.length) * 100)
  }
  const m = typeof manual === 'number' ? normalizeProgress(manual) : null
  return m ?? 0
}

/** 진행률이 체크리스트/상태로 자동 산출되는 상황인지 (UI에서 수동 슬라이더 숨김 판단) */
export function isProgressAuto(
  checklist: DeptTaskChecklistItem[] | undefined,
  status: DailyLogEntryType,
): boolean {
  return status === 'done' || (Array.isArray(checklist) && checklist.length > 0)
}

// ── 홈 노출용: 기한/요약/정렬 (순수 함수 SSOT) ──

export type DueTone = 'overdue' | 'today' | 'soon' | 'future' | 'none'
const SOON_DAYS = 3

/** target_date(YYYY-MM-DD)와 오늘(YYYY-MM-DD)의 일수 차. null이면 null. (오늘 기준, 양수=미래) */
export function dueDiffDays(targetDate: string | null | undefined, today: string): number | null {
  if (!targetDate) return null
  const t = Date.parse(`${targetDate}T00:00:00Z`)
  const d = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(t) || Number.isNaN(d)) return null
  return Math.round((t - d) / 86_400_000)
}

/** 기한 상대표기 + 톤. "지남 D+2 / 오늘 / D-3 / 6.20" */
export function formatDueLabel(targetDate: string | null | undefined, today: string): { text: string; tone: DueTone } {
  const diff = dueDiffDays(targetDate, today)
  if (diff === null) return { text: '기한 없음', tone: 'none' }
  if (diff < 0) return { text: `지남 D+${-diff}`, tone: 'overdue' }
  if (diff === 0) return { text: '오늘', tone: 'today' }
  if (diff <= SOON_DAYS) return { text: `D-${diff}`, tone: 'soon' }
  return { text: `D-${diff}`, tone: 'future' }
}

interface UrgencyTask {
  entry_type: DailyLogEntryType
  priority: 'urgent' | 'high' | 'normal' | 'low'
  target_date: string | null
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** 챙김 우선순위 정렬: ①기한경과 ②블로커 ③임박(D-3내) ④우선순위 ⑤기한 가까운 순(null 후순위) */
export function compareDeptTaskUrgency(a: UrgencyTask, b: UrgencyTask, today: string): number {
  const tier = (t: UrgencyTask): number => {
    const diff = dueDiffDays(t.target_date, today)
    if (diff !== null && diff < 0) return 0          // 기한경과
    if (t.entry_type === 'blocker') return 1         // 블로커
    if (diff !== null && diff <= SOON_DAYS) return 2 // 임박
    return 3
  }
  const ta = tier(a), tb = tier(b)
  if (ta !== tb) return ta - tb
  const pa = PRIORITY_RANK[a.priority] ?? 2, pb = PRIORITY_RANK[b.priority] ?? 2
  if (pa !== pb) return pa - pb
  const da = dueDiffDays(a.target_date, today), db = dueDiffDays(b.target_date, today)
  if (da === null && db === null) return 0
  if (da === null) return 1
  if (db === null) return -1
  return da - db
}

export interface DeptTaskCounts { total: number; overdue: number; blocker: number; dueToday: number }

/** 홈 요약 카운트 (미완료 집합 기준으로 호출) */
export function summarizeDeptTasks(tasks: UrgencyTask[], today: string): DeptTaskCounts {
  let overdue = 0, blocker = 0, dueToday = 0
  for (const t of tasks) {
    const diff = dueDiffDays(t.target_date, today)
    if (diff !== null && diff < 0) overdue += 1
    if (t.entry_type === 'blocker') blocker += 1
    if (diff === 0) dueToday += 1
  }
  return { total: tasks.length, overdue, blocker, dueToday }
}

/** 줄단위 텍스트 → 체크리스트 항목 배열 (빈 줄 제거) */
export function parseChecklistText(text: string): DeptTaskChecklistItem[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ label, done: false }))
}
