// 주간보고 AI push 초안(draft) — 분류·생성 SSOT의 공용 타입.
// 분류/생성 로직은 classify.ts·generate-draft.ts에만 두고, 라우트/FE는 이 타입으로만 주고받는다.
import type { DailyTaskInput } from '../gemini-daily-to-weekly.ts'

/** 주간보고 2층 구조의 하단 섹션. */
export type DraftSection = 'performance' | 'plan' | 'issues'

/** 항목 출처 — auto: AI/규칙이 생성, manual: 사람이 직접 추가/편집. */
export type DraftOrigin = 'auto' | 'manual'

/** 초안 한 항목(불릿). 카테고리(구분) → 섹션 2층 아래의 개별 줄. */
export interface DraftItem {
  /** 저장 후 부여되는 DB id (생성 직후엔 미정). */
  id?: string
  /** 구분(카테고리). 지난주/부서 구분 명칭과 통일. */
  category: string
  section: DraftSection
  content: string
  origin: DraftOrigin
  /** 0~1. null = 신뢰도 불명(휴리스틱·사실데이터 등 판단 보류). */
  confidence: number | null
  /** 사용자가 최종 보고에 포함할지 여부(기본 true). */
  isIncluded: boolean
  /** 근거 원본 참조(있으면). 없으면 null. */
  sourceRef?: { kind: 'daily' | 'calendar'; id: string } | null
  /** 표시 정렬 순서(0부터). */
  sortOrder: number
}

/** 캘린더 일정 입력(주간보고 초안 항목화용). calendar_events 응답의 부분집합. */
export interface CalendarInput {
  id: string
  title: string
  description?: string
  startAt: string
  endAt?: string
  allDay: boolean
  status?: string
}

/**
 * 초안 생성 입력.
 * - tasks: 그 주 일일업무
 * - pastEvents/futureEvents: 호출처가 classifyEventSection으로 분기해 넘긴 과거/미래 일정
 * - prevCategories → deptCategories: 구분 참조계층(앞쪽 우선)
 * - styleGuide: 조직 주간보고 스타일 가이드(없으면 기본 가이드 사용)
 */
export interface DraftGenInput {
  tasks: DailyTaskInput[]
  pastEvents: CalendarInput[]
  futureEvents: CalendarInput[]
  prevCategories?: string[]
  deptCategories?: string[]
  styleGuide?: string
}
