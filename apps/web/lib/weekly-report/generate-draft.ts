// 주간보고 AI push 초안 생성 SSOT.
// 기존 generateWeeklyFromDailyTasks(시그니처 불변·token-logger 경유)를 확장 기반으로 재사용하되,
// 캘린더 일정 항목화와 구분 참조계층(prevCategories → deptCategories) 주입을 더해 DraftItem[]로 변환한다.
import {
  generateWeeklyFromDailyTasks,
  type DailyTaskInput,
  type WeeklyRowOutput,
} from '../gemini-daily-to-weekly.ts'
import { htmlToPlain } from '../html-to-plain.ts'
import { classifyTaskSection } from './classify.ts'
import { sectionToLines } from './section-lines.ts'
import type { CalendarInput, DraftGenInput, DraftItem, DraftSection } from './draft-types.ts'

// AI가 생성한 섹션 항목 — 추론값이라 중간 신뢰도.
const AI_DEFAULT_CONFIDENCE = 0.7
// 캘린더 일정 = 사실 데이터(추론 아님) → 신뢰도 불명(null)로 두어 검수 시 자동 강조 대상에서 제외.
const CALENDAR_CONFIDENCE: number | null = null
// AI 실패 폴백 = 규칙기반 휴리스틱 분류 → 신뢰도 불명.
const FALLBACK_CONFIDENCE: number | null = null

const CALENDAR_CATEGORY = '일정/회의'
const FALLBACK_CATEGORY = '주간 업무'
const SECTION_ORDER: readonly DraftSection[] = ['performance', 'plan', 'issues']

const DEFAULT_STYLE_GUIDE =
  '간결한 개조식 문장으로, 업무 영역별 구분(category)을 만들고 성과/계획/이슈를 분리해 작성한다.'

// sectionToLines는 section-lines.ts(SSOT)에서 import — node:test 로드 가능하도록 순수 변환만 분리(§재사용).

/** WeeklyRowOutput[](구분별 묶음)을 섹션별 DraftItem으로 펼친다(섹션 HTML은 불릿별 plain 항목으로). */
function rowsToItems(rows: WeeklyRowOutput[]): DraftItem[] {
  const items: DraftItem[] = []
  for (const row of rows) {
    const bySection: Record<DraftSection, string> = {
      performance: row.performance ?? '',
      plan: row.plan ?? '',
      issues: row.issues ?? '',
    }
    for (const section of SECTION_ORDER) {
      for (const content of sectionToLines(bySection[section])) {
        items.push({
          category: row.category,
          section,
          content,
          origin: 'auto',
          confidence: AI_DEFAULT_CONFIDENCE,
          isIncluded: true,
          sourceRef: null,
          sortOrder: 0,
        })
      }
    }
  }
  return items
}

/** 캘린더 일정을 섹션 고정으로 항목화. (호출처가 past→performance, future→plan으로 분기해 넘김) */
function eventsToItems(events: CalendarInput[], section: DraftSection): DraftItem[] {
  return events.map((ev) => {
    const desc = ev.description ? htmlToPlain(ev.description) : ''
    const content = desc ? `${ev.title}\n${desc}` : ev.title
    return {
      category: CALENDAR_CATEGORY,
      section,
      content,
      origin: 'auto' as const,
      confidence: CALENDAR_CONFIDENCE,
      isIncluded: true,
      sourceRef: { kind: 'calendar' as const, id: ev.id },
      sortOrder: 0,
    }
  })
}

/**
 * AI 실패 시 결정론적 폴백 — 일일업무를 classifyTaskSection으로만 분류한 최소 항목.
 * [설계결정] 안정성(35)·확장성(25) 가중 → 빈 배열이 아니라 폴백을 택한다.
 *  push 모델에서 사용자는 "초안이 이미 존재"를 기대하므로, Gemini 장애 시 빈 초안은 명백한 UX 파손이다.
 *  규칙기반 분류는 항상 검수 가능한 초안을 보장하고, confidence=null로 전 항목을 "확인 필요"로 표식한다.
 */
function fallbackTaskItems(tasks: DailyTaskInput[]): DraftItem[] {
  return tasks.map((t) => ({
    category: FALLBACK_CATEGORY,
    section: classifyTaskSection(t),
    content: htmlToPlain(t.content),
    origin: 'auto' as const,
    confidence: FALLBACK_CONFIDENCE,
    isIncluded: true,
    sourceRef: null,
    sortOrder: 0,
  }))
}

/** 일일업무 → AI 주간 변환(구분 참조계층 주입). 실패 시 throw → 상위에서 폴백. */
async function aiTaskRows(
  tasks: DailyTaskInput[],
  styleGuide: string,
  refCategories: string[] | undefined,
  apiKey: string,
  model: string,
  userId?: string | null,
): Promise<WeeklyRowOutput[]> {
  const normalized = tasks.map((t) => ({ ...t, content: htmlToPlain(t.content) }))
  return generateWeeklyFromDailyTasks(normalized, styleGuide, apiKey, model, userId, refCategories)
}

/**
 * 주간보고 초안 생성 SSOT.
 * 캘린더 항목은 결정론적으로 항상 포함하고, 일일업무는 AI 변환을 시도하되 실패 시 규칙기반 폴백한다.
 * (token 사용은 generateWeeklyFromDailyTasks가 token-logger로 기록 — 그 경로 유지)
 */
export async function generateWeeklyDraft(
  input: DraftGenInput,
  apiKey: string,
  model: string,
  userId?: string | null,
): Promise<DraftItem[]> {
  const refCategories =
    input.prevCategories && input.prevCategories.length > 0
      ? input.prevCategories
      : input.deptCategories
  const styleGuide = input.styleGuide?.trim() || DEFAULT_STYLE_GUIDE

  const calendarItems = [
    ...eventsToItems(input.pastEvents, 'performance'),
    ...eventsToItems(input.futureEvents, 'plan'),
  ]

  let taskItems: DraftItem[]
  try {
    const rows = await aiTaskRows(input.tasks, styleGuide, refCategories, apiKey, model, userId)
    taskItems = rowsToItems(rows)
  } catch {
    // graceful degrade — AI 장애여도 검수 가능한 초안을 보장(설계결정: fallbackTaskItems 주석 참고)
    taskItems = fallbackTaskItems(input.tasks)
  }

  // sortOrder 일괄 재부여(섹션 정렬은 호출처/FE 표시단에서) — AI 항목 먼저, 캘린더 뒤.
  return [...taskItems, ...calendarItems].map((it, i) => ({ ...it, sortOrder: i }))
}
