'use server'

// 회의노트 Server Actions — 생성/수정/소프트삭제/요약저장/추출 일괄반영.
// 패턴 출처: calendar/actions.ts(createCalendarEvent 재사용), daily/actions.ts(daily_logs insert).
// 보안: 인증(auth.uid)·본인검증 필수, RLS가 행 권한 강제(이중 방어), body_plain은 htmlToPlain(SSOT) 산출.
// 입력 검증: zod로 서버 재검증. 일괄반영은 부분실패 안전(개별 try, 집계 반환).
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { htmlToPlain } from '@/lib/html-to-plain'
import { createCalendarEvent } from '@/app/(member)/calendar/actions'
import { sanitizeSearchQuery, toStartAt } from '@/lib/meeting/parse-helpers'

// 본문 HTML 상한(DoS·row bloat 방지). 일반 회의록은 충분히 수용.
const BODY_HTML_MAX = 200_000

const MEETING_NOTES_PATH = '/meeting-notes'

type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string }

// ---- 입력 스키마 ----
const statusSchema = z.enum(['draft', 'final', 'archived'])

const createSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력해 주세요.').max(300, '제목이 너무 깁니다.'),
  meeting_at: z.string().trim().min(1).nullish(),
  attendees: z.array(z.string().trim().min(1)).max(200).nullish(),
  body_html: z.string().max(BODY_HTML_MAX, '본문이 너무 깁니다.').nullish(),
  tags: z.array(z.string().trim().min(1)).max(100).nullish(),
  status: statusSchema.optional(),
})

const updateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  meeting_at: z.string().trim().min(1).nullable().optional(),
  attendees: z.array(z.string().trim().min(1)).max(200).nullable().optional(),
  body_html: z.string().max(BODY_HTML_MAX, '본문이 너무 깁니다.').nullable().optional(),
  tags: z.array(z.string().trim().min(1)).max(100).nullable().optional(),
  status: statusSchema.optional(),
})

const summarySchema = z.object({
  summary: z.string().max(20000).optional(),
  decisions: z.string().max(20000).optional(),
})

// 추출 일괄반영 입력 — extractMeetingItems 후보 형태와 호환(FE가 사용자 선택분만 전달).
const applyItemsSchema = z.object({
  tasks: z
    .array(z.object({ title: z.string().trim().min(1) }))
    .max(100)
    .optional()
    .default([]),
  events: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        suggested_date: z.string().trim().min(1).nullish(),
        suggested_time: z.string().trim().min(1).nullish(),
      })
    )
    .max(100)
    .optional()
    .default([]),
})

export type CreateMeetingNoteInput = z.input<typeof createSchema>
export type UpdateMeetingNoteInput = z.input<typeof updateSchema>

const uuidSchema = z.string().uuid('잘못된 식별자입니다.')

function zodError(e: z.ZodError): string {
  return e.errors[0]?.message ?? '입력값이 올바르지 않습니다.'
}

// ============================================================
// 생성
// ============================================================
export async function createMeetingNote(
  input: CreateMeetingNoteInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = createSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: zodError(parsed.error) }
    const v = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다.' }

    const bodyHtml = v.body_html ?? null
    const { data, error } = await (supabase.from('meeting_notes') as any)
      .insert({
        user_id: user.id,
        title: v.title,
        meeting_at: v.meeting_at ?? null,
        attendees: v.attendees ?? null,
        body_html: bodyHtml,
        body_plain: htmlToPlain(bodyHtml),
        tags: v.tags ?? null,
        status: v.status ?? 'draft',
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: `저장 실패: ${error.message}` }
    revalidatePath(MEETING_NOTES_PATH)
    return { ok: true, id: data.id as string }
  } catch (e) {
    console.error('[createMeetingNote]', e)
    return { ok: false, error: e instanceof Error ? e.message : '저장 실패' }
  }
}

// ============================================================
// 수정 (본인 행만 — RLS + 명시 user_id 조건 이중 방어)
// body_html 변경 시 body_plain 재계산.
// ============================================================
export async function updateMeetingNote(
  id: string,
  patch: UpdateMeetingNoteInput
): Promise<ActionResult<Record<never, never>>> {
  try {
    const idCheck = uuidSchema.safeParse(id)
    if (!idCheck.success) return { ok: false, error: idCheck.error.errors[0].message }

    const parsed = updateSchema.safeParse(patch)
    if (!parsed.success) return { ok: false, error: zodError(parsed.error) }
    const v = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다.' }

    const payload: Record<string, unknown> = {}
    if (v.title !== undefined) payload.title = v.title
    if (v.meeting_at !== undefined) payload.meeting_at = v.meeting_at
    if (v.attendees !== undefined) payload.attendees = v.attendees
    if (v.tags !== undefined) payload.tags = v.tags
    if (v.status !== undefined) payload.status = v.status
    if (v.body_html !== undefined) {
      payload.body_html = v.body_html
      payload.body_plain = htmlToPlain(v.body_html)
    }
    if (Object.keys(payload).length === 0) return { ok: true }

    const { error } = await (supabase.from('meeting_notes') as any)
      .update(payload)
      .eq('id', idCheck.data)
      .eq('user_id', user.id)
      .is('deleted_at', null)

    if (error) return { ok: false, error: `수정 실패: ${error.message}` }
    revalidatePath(MEETING_NOTES_PATH)
    return { ok: true }
  } catch (e) {
    console.error('[updateMeetingNote]', e)
    return { ok: false, error: e instanceof Error ? e.message : '수정 실패' }
  }
}

// ============================================================
// 소프트삭제 (deleted_at)
// ============================================================
export async function deleteMeetingNote(id: string): Promise<ActionResult<Record<never, never>>> {
  try {
    const idCheck = uuidSchema.safeParse(id)
    if (!idCheck.success) return { ok: false, error: idCheck.error.errors[0].message }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다.' }

    const { error } = await (supabase.from('meeting_notes') as any)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', idCheck.data)
      .eq('user_id', user.id)
      .is('deleted_at', null)

    if (error) return { ok: false, error: `삭제 실패: ${error.message}` }
    revalidatePath(MEETING_NOTES_PATH)
    return { ok: true }
  } catch (e) {
    console.error('[deleteMeetingNote]', e)
    return { ok: false, error: e instanceof Error ? e.message : '삭제 실패' }
  }
}

// ============================================================
// AI 요약 저장 (summary/decisions — 생성형 결과 확정 저장)
// ============================================================
export async function saveMeetingSummary(
  id: string,
  payload: { summary?: string; decisions?: string }
): Promise<ActionResult<Record<never, never>>> {
  try {
    const idCheck = uuidSchema.safeParse(id)
    if (!idCheck.success) return { ok: false, error: idCheck.error.errors[0].message }

    const parsed = summarySchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: zodError(parsed.error) }

    // 제공된 필드만 갱신(미제공 필드를 빈 문자열로 덮어쓰지 않음).
    const update: Record<string, string> = {}
    if (parsed.data.summary !== undefined) update.summary = parsed.data.summary
    if (parsed.data.decisions !== undefined) update.decisions = parsed.data.decisions
    if (Object.keys(update).length === 0) return { ok: true }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다.' }

    const { error } = await (supabase.from('meeting_notes') as any)
      .update(update)
      .eq('id', idCheck.data)
      .eq('user_id', user.id)
      .is('deleted_at', null)

    if (error) return { ok: false, error: `요약 저장 실패: ${error.message}` }
    revalidatePath(MEETING_NOTES_PATH)
    return { ok: true }
  } catch (e) {
    console.error('[saveMeetingSummary]', e)
    return { ok: false, error: e instanceof Error ? e.message : '요약 저장 실패' }
  }
}

// ============================================================
// 추출 항목 일괄반영
//  - tasks → daily_logs INSERT (entry_type='planned', source_type='ai_derived', meeting_note_id, content=title, log_date=오늘)
//  - events → createCalendarEvent 재사용 (link_kind='meeting', link_id=meetingNoteId, start_at=suggested_date(+time))
//  부분실패 안전: 개별 try, 실패는 카운트에서 제외(전체 롤백 없음 — best-effort 반영).
// ============================================================
// DATE_RE/TIME_RE/toStartAt는 lib/meeting/parse-helpers.ts(SSOT) 재사용.
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function applyExtractedItems(
  meetingNoteId: string,
  payload: {
    tasks?: { title: string }[]
    events?: { title: string; suggested_date?: string | null; suggested_time?: string | null }[]
  }
): Promise<ActionResult<{ tasksCreated: number; eventsCreated: number }>> {
  try {
    const idCheck = uuidSchema.safeParse(meetingNoteId)
    if (!idCheck.success) return { ok: false, error: idCheck.error.errors[0].message }

    const parsed = applyItemsSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: zodError(parsed.error) }
    const { tasks, events } = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다.' }

    // 회의노트 소유 검증 (RLS + 명시 조건 이중 방어)
    const { data: note } = await (supabase.from('meeting_notes') as any)
      .select('id')
      .eq('id', idCheck.data)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!note) return { ok: false, error: '회의노트를 찾을 수 없습니다.' }

    const today = todayStr()
    let tasksCreated = 0
    let eventsCreated = 0

    // tasks → daily_logs (개인 planned 업무, 출처 추적)
    for (const t of tasks) {
      try {
        const { error } = await (supabase.from('daily_logs') as any).insert({
          user_id: user.id,
          log_date: today,
          content: t.title,
          entry_type: 'planned',
          source_type: 'ai_derived',
          meeting_note_id: idCheck.data,
        })
        if (!error) tasksCreated += 1
        else console.error('[applyExtractedItems] task insert', error)
      } catch (e) {
        console.error('[applyExtractedItems] task insert ex', e)
      }
    }

    // events → calendar_events (createCalendarEvent 재사용, link_kind='meeting')
    for (const ev of events) {
      const startAt = toStartAt(ev.suggested_date, ev.suggested_time)
      if (!startAt) continue // 날짜 없는 후보는 일정으로 만들지 않음
      try {
        const res = await createCalendarEvent({
          title: ev.title,
          start_at: startAt,
          link_kind: 'meeting',
          link_id: idCheck.data,
          source: 'ai',
        })
        if (res.ok) eventsCreated += 1
        else console.error('[applyExtractedItems] event create', res.error)
      } catch (e) {
        console.error('[applyExtractedItems] event create ex', e)
      }
    }

    revalidatePath(MEETING_NOTES_PATH)
    revalidatePath('/daily')
    revalidatePath('/calendar')
    return { ok: true, tasksCreated, eventsCreated }
  } catch (e) {
    console.error('[applyExtractedItems]', e)
    return { ok: false, error: e instanceof Error ? e.message : '반영 실패' }
  }
}

// ============================================================
// 목록 조회 (서버 페이지네이션 + 검색·정렬·상태필터)
//  - RLS가 행 권한 강제(본인 OR admin). 활성행만(deleted_at IS NULL).
//  - 검색: 제목/본문plain ilike. 정렬: 회의일시/작성일/제목.
//  반환: { items, total, page, limit } — page는 1-base, 결과 없으면 빈 배열.
// ============================================================
export interface MeetingNoteListItem {
  id: string
  title: string
  meeting_at: string | null
  status: string
  summary: string | null
  body_plain: string | null
  created_at: string
  department_id: string | null
  tags: string[] | null
}

export interface ListMeetingNotesResult {
  items: MeetingNoteListItem[]
  total: number
  page: number
  limit: number
}

export async function listMeetingNotes(params: {
  q?: string
  sort?: string
  filter?: string
  page?: number
  limit?: number
}): Promise<ListMeetingNotesResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 20)))
  const q = (params.q ?? '').trim()
  const sort = params.sort ?? 'recent'
  const filter = params.filter ?? 'all'

  const empty: ListMeetingNotesResult = { items: [], total: 0, page, limit }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return empty

  let query = (supabase.from('meeting_notes') as any)
    .select('id, title, meeting_at, status, summary, body_plain, created_at, department_id, tags', { count: 'exact' })
    .is('deleted_at', null)

  if (filter !== 'all' && ['draft', 'final', 'archived'].includes(filter)) {
    query = query.eq('status', filter)
  }
  if (q) {
    const safe = sanitizeSearchQuery(q)
    query = query.or(`title.ilike.%${safe}%,body_plain.ilike.%${safe}%`)
  }

  // 정렬: recent=회의일시 desc(NULL 후순위), oldest=회의일시 asc, created=작성일 desc, title=제목 asc
  if (sort === 'oldest') query = query.order('meeting_at', { ascending: true, nullsFirst: false })
  else if (sort === 'created') query = query.order('created_at', { ascending: false })
  else if (sort === 'title') query = query.order('title', { ascending: true })
  else query = query.order('meeting_at', { ascending: false, nullsFirst: false })

  const from = (page - 1) * limit
  query = query.range(from, from + limit - 1)

  const { data, error, count } = await query
  if (error) {
    console.error('[listMeetingNotes]', error)
    throw new Error(error.message)
  }
  return {
    items: (data ?? []) as MeetingNoteListItem[],
    total: count ?? 0,
    page,
    limit,
  }
}

// ============================================================
// 단건 조회 (상세/편집) — 본인 OR admin(RLS). 없으면 null.
// ============================================================
export interface MeetingNoteDetail {
  id: string
  title: string
  meeting_at: string | null
  status: string
  attendees: string | null
  tags: string[] | null
  body: string | null
  body_plain: string | null
  summary: string | null
  decisions: string | null
  created_at: string
}

export async function getMeetingNote(id: string): Promise<MeetingNoteDetail | null> {
  const idCheck = uuidSchema.safeParse(id)
  if (!idCheck.success) return null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await (supabase.from('meeting_notes') as any)
    .select('id, title, meeting_at, status, attendees, tags, body_html, body_plain, summary, decisions, created_at')
    .eq('id', idCheck.data)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    console.error('[getMeetingNote]', error)
    return null
  }
  if (!data) return null

  // attendees는 DB에서 text[] — 상세 화면은 콤마 문자열로 표시(편집 입력과 호환)
  const attendees: string | null = Array.isArray(data.attendees)
    ? (data.attendees as string[]).join(', ')
    : (data.attendees ?? null)

  return {
    id: data.id,
    title: data.title,
    meeting_at: data.meeting_at,
    status: data.status,
    attendees,
    tags: data.tags ?? null,
    body: data.body_html ?? null,
    body_plain: data.body_plain ?? null,
    summary: data.summary ?? null,
    decisions: data.decisions ?? null,
    created_at: data.created_at,
  }
}
