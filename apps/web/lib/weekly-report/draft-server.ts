// 주간보고 초안 서버 헬퍼 — route 핸들러(얇게 유지)에서 분리한 생성·조회 로직.
// 라우트는 GET/PUT 오케스트레이션만 두고, 데이터 적재·AI 생성은 여기로.
import { readFileSync } from 'fs'
import { join } from 'path'
import { createAdminClient } from '@/lib/supabase/server'
import { addKstDays, kstRangeToUtc } from '@/lib/datetime/kst'
import { classifyEventSection } from '@/lib/weekly-report/classify'
import { generateWeeklyDraft } from '@/lib/weekly-report/generate-draft'
import { htmlToPlain } from '@/lib/html-to-plain'
import type { CalendarInput, DraftItem } from '@/lib/weekly-report/draft-types'
import type { DailyTaskInput } from '@/lib/gemini-daily-to-weekly'

// content(plain 필드)에 HTML 태그가 섞여 저장된 오염행 감지용.
const HTML_TAG_RE = /<[a-z][^>]*>/i

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/
const DRAFT_HORIZON_DAYS = 13 // 이번주(0~6) + 다음주(7~13) 캘린더 범위
export const MAX_ITEMS = 200
export const MAX_CATEGORY_LEN = 100
export const MAX_CONTENT_LEN = 5000
export const MAX_SOURCE_REF_BYTES = 2048

/** week_start 가 유효한 달력일이며 월요일(기존 weekly_reports DOW=1 정책)인지 검증. */
export function isValidWeekStart(week: string): boolean {
  if (!WEEK_RE.test(week)) return false
  const d = new Date(`${week}T00:00:00Z`) // 순수 달력일 검증용(벽시계 변환 아님)
  if (Number.isNaN(d.getTime())) return false
  if (d.toISOString().slice(0, 10) !== week) return false // kst-ok: 02-30 등 무효일 차단
  return d.getUTCDay() === 1 // 월요일
}

/** 사용자 입력 문자열을 상한으로 절단(저장형 DoS 방지). */
export function clampText(s: unknown, max: number): string {
  return typeof s === 'string' ? s.slice(0, max) : ''
}

let styleGuideCache: string | null = null
function loadStyleGuide(): string {
  if (styleGuideCache !== null) return styleGuideCache // 매 요청 readFileSync 방지
  try {
    styleGuideCache = readFileSync(join(process.cwd(), 'docs', 'weekly-report-ai-style.md'), 'utf-8')
  } catch {
    styleGuideCache = ''
  }
  return styleGuideCache
}

/** DB 행(snake) → DraftItem(camel). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToItem(r: any): DraftItem {
  // 방어변환: v0.7.281 초안이 HTML(<ul><li>)을 content에 저장한 오염행을 읽을 때 plain으로 복구(§5-1).
  const rawContent = r.content ?? ''
  const content = HTML_TAG_RE.test(rawContent) ? htmlToPlain(rawContent) : rawContent
  return {
    id: r.id,
    category: r.category ?? '',
    section: r.section,
    content,
    origin: r.origin,
    confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
    isIncluded: r.is_included !== false,
    sourceRef: r.source_ref ?? null,
    sortOrder: r.sort_order ?? 0,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadDeptId(admin: any, userId: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from('v_user_departments')
      .select('department_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    return data?.department_id ?? null
  } catch {
    return null
  }
}

/** 해당 주차 활성 항목을 sortOrder 순으로 로드. 조회 실패 시 null. */
export async function loadItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  week: string,
): Promise<DraftItem[] | null> {
  const { data, error } = await supabase
    .from('weekly_report_items')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', week)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('[weekly-report/draft] items 조회 실패', error)
    return null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(rowToItem)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPrevCategories(admin: any, userId: string): Promise<string[]> {
  try {
    const { data } = await admin
      .from('weekly_reports')
      .select('week_start, category')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('week_start', { ascending: false })
      .limit(50)
    const list = (data ?? []) as { week_start: string; category: string }[]
    if (list.length === 0) return []
    const latest = list[0].week_start
    return Array.from(
      new Set(list.filter((r) => r.week_start === latest).map((r) => r.category).filter(Boolean)),
    )
  } catch {
    return []
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadDeptCategories(admin: any, userId: string): Promise<string[]> {
  try {
    const deptId = await loadDeptId(admin, userId)
    if (!deptId) return []
    const { data } = await admin
      .from('dept_weekly_reports')
      .select('body')
      .eq('department_id', deptId)
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
    const body = (data?.body ?? []) as { category?: string }[]
    return Array.from(new Set(body.map((b) => b.category).filter((c): c is string => !!c)))
  } catch {
    return []
  }
}

/** 일일업무 + 캘린더 → AI 초안 생성 후 weekly_report_items에 저장하고 DraftItem[] 반환. */
export async function generateForWeek(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  week: string,
): Promise<DraftItem[]> {
  const weekEnd = addKstDays(week, 6) // KST SSOT

  // 일일업무(그 주) — 기존 pull 흐름(/api/daily/week 기본 스코프)과 동일하게 본인+담당
  const { data: logs } = await supabase
    .from('daily_logs')
    .select('content, entry_type, log_date, is_resolved, priority')
    .eq('is_onboarding', false)
    .is('deleted_at', null)
    .or(`user_id.eq.${userId},assignee_user_id.eq.${userId}`)
    .gte('log_date', week)
    .lte('log_date', weekEnd)
    .limit(1000)
  const tasks: DailyTaskInput[] = ((logs ?? []) as Record<string, unknown>[])
    .map((l) => ({
      content: typeof l.content === 'string' ? l.content : '',
      entry_type: typeof l.entry_type === 'string' ? l.entry_type : 'done',
      log_date: typeof l.log_date === 'string' ? l.log_date : '',
      is_resolved: typeof l.is_resolved === 'boolean' ? l.is_resolved : false,
      priority: typeof l.priority === 'string' ? l.priority : 'normal',
    }))
    .filter((t) => t.content.trim() !== '')

  // 캘린더(이번주~다음주) — KST 범위 SSOT. 본인 일정만(defense-in-depth) + 취소 제외.
  const horizonEnd = addKstDays(week, DRAFT_HORIZON_DAYS)
  const { fromIso, toIso } = kstRangeToUtc(week, horizonEnd)
  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, title, description, start_at, end_at, all_day, status')
    .eq('user_id', userId)
    .neq('status', 'canceled')
    .gte('start_at', fromIso)
    .lte('start_at', toIso)
    .order('start_at', { ascending: true })
    .limit(500)
  const calInputs: CalendarInput[] = ((events ?? []) as Record<string, unknown>[]).map((e) => ({
    id: String(e.id),
    title: typeof e.title === 'string' ? e.title : '',
    description: typeof e.description === 'string' ? e.description : undefined,
    startAt: String(e.start_at),
    endAt: e.end_at ? String(e.end_at) : undefined,
    allDay: e.all_day === true,
    status: typeof e.status === 'string' ? e.status : undefined,
  }))
  const pastEvents = calInputs.filter((e) => classifyEventSection(e, week) === 'performance')
  const futureEvents = calInputs.filter((e) => classifyEventSection(e, week) === 'plan')

  // AI 키/모델 + 구분 참조계층(개인 지난주 → 부서)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  const prevCategories = await loadPrevCategories(admin, userId)
  const deptCategories = await loadDeptCategories(admin, userId)

  const draftItems = await generateWeeklyDraft(
    { tasks, pastEvents, futureEvents, prevCategories, deptCategories, styleGuide: loadStyleGuide() },
    apiKey,
    model,
    userId,
  )

  // 데이터 0건이면 빈 초안(graceful degrade) — 저장 없이 반환
  if (draftItems.length === 0) return []

  const deptId = await loadDeptId(admin, userId)
  const rows = draftItems.slice(0, MAX_ITEMS).map((it, i) => ({
    user_id: userId,
    week_start: week,
    department_id: deptId,
    category: it.category,
    section: it.section,
    content: it.content,
    origin: it.origin,
    confidence: it.confidence,
    is_included: it.isIncluded,
    source_ref: it.sourceRef ?? null,
    sort_order: i,
  }))

  const { data: inserted, error: insErr } = await supabase
    .from('weekly_report_items')
    .insert(rows)
    .select('*')
  if (insErr) {
    console.error('[generateForWeek] insert 실패', insErr)
    return draftItems // 저장 실패해도 생성 결과 반환 — 다음 저장 때 재시도
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (inserted as any[]).map(rowToItem)
}
