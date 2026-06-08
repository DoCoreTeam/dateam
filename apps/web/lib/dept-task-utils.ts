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

/** 줄단위 텍스트 → 체크리스트 항목 배열 (빈 줄 제거) */
export function parseChecklistText(text: string): DeptTaskChecklistItem[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ label, done: false }))
}
