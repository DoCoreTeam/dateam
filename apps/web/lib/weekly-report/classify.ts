// 주간보고 초안 항목의 섹션(성과/계획/이슈) 분류 — 순수함수 SSOT (AI 호출 없음).
// 라우트는 캘린더 분기에 classifyEventSection을, AI 실패 폴백·일일업무 분류에 classifyTaskSection을 재사용한다.
import { addKstDays, kstDateKey } from '../datetime/kst.ts'
import type { CalendarInput, DraftItem, DraftSection } from './draft-types.ts'

const WEEK_LENGTH_DAYS = 7

/** 미래지향 표현 — 본문에 이 표현이 있으면 계획(plan)으로 본다. (매직 문자열 금지) */
export const FUTURE_INTENT_PATTERNS: readonly string[] = [
  '예정',
  '계획',
  '할 것',
  '할것',
  '다음 주',
  '다음주',
  '다음 단계',
  '준비 중',
  '준비중',
  '진행 예정',
  '추진 예정',
  '목표',
] as const

/** 이 값 미만의 confidence 는 "낮음"(검수 강조 대상)으로 본다. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5

function hasFutureIntent(content: string): boolean {
  return FUTURE_INTENT_PATTERNS.some((p) => content.includes(p))
}

/**
 * 일일업무 한 건의 섹션 판정 (시점+의미, 결정론적).
 *  - 미해결(is_resolved===false) → issues
 *  - 본문에 미래지향 표현 → plan
 *  - 그 외(과거 완료 기록) → performance
 */
export function classifyTaskSection(task: {
  content: string
  is_resolved: boolean
}): DraftSection {
  if (task.is_resolved === false) return 'issues'
  if (hasFutureIntent(task.content ?? '')) return 'plan'
  return 'performance'
}

/** weekStart('YYYY-MM-DD')에 days 더한 KST 날짜키. (kst.ts SSOT 재사용) */
function addDaysKey(weekStartKey: string, days: number): string {
  return addKstDays(weekStartKey, days)
}

/**
 * 캘린더 일정의 섹션 판정 (KST 날짜 기준).
 *  - 이번주 범위(weekStart ~ weekStart+6일) 종료 이내 → performance(이미 한/하는 일)
 *  - 그 이후(다음주 등) → plan
 */
export function classifyEventSection(event: CalendarInput, weekStart: string): DraftSection {
  const evKey = kstDateKey(event.startAt)
  if (!evKey) return 'performance'
  const weekEndKey = addDaysKey(weekStart, WEEK_LENGTH_DAYS - 1)
  return evKey > weekEndKey ? 'plan' : 'performance'
}

/** 항목 신뢰도가 낮은지(검수 강조). null(불명)은 낮음으로 보지 않는다. */
export function isLowConfidence(item: Pick<DraftItem, 'confidence'>): boolean {
  return item.confidence !== null && item.confidence < LOW_CONFIDENCE_THRESHOLD
}
