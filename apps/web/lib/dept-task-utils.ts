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

/** 줄단위 텍스트 → 체크리스트 항목 배열 (빈 줄 제거) */
export function parseChecklistText(text: string): DeptTaskChecklistItem[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ label, done: false }))
}
