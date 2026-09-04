'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { recordFeedbackSignal } from '@/lib/daily/feedback-signals'
import { normalizeKstWallString } from '@/lib/datetime/kst'
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/gemini-model'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface Recommendation {
  title: string
  start_at: string
  reason: string
  link_kind?: 'daily' | 'weekly' | 'memo' | null
  link_id?: string | null
}

/** AI 다음 일정 추천 — 규칙 후보(일일 planned·주간 plan·미처리 memo) + Gemini 종합 */
export async function getCalendarRecommendations(): Promise<{ ok: boolean; items?: Recommendation[]; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다' }

    // 1차 규칙 후보 (본인 데이터 — RLS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: planned } = await sb.from('daily_logs')
      .select('id, content, entry_type, target_date, memo_status')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .eq('is_onboarding', false)   // 온보딩 실습 행 제외(뱃지/캘린더 오염 방지)
      .in('entry_type', ['planned', 'doing', 'note'])
      .order('logged_at', { ascending: false }).limit(40)
    const { data: weekly } = await sb.from('weekly_reports')
      .select('id, category, plan, performance')
      .eq('user_id', user.id).is('deleted_at', null)
      .order('week_start', { ascending: false }).limit(10)

    const candidates: { kind: string; id: string; text: string }[] = []
    for (const r of planned ?? []) {
      if (r.entry_type === 'note' && r.memo_status && r.memo_status !== 'new') continue
      candidates.push({ kind: r.entry_type === 'note' ? 'memo' : 'daily', id: r.id, text: `[${r.entry_type}] ${r.content}${r.target_date ? ` (목표 ${r.target_date})` : ''}` })
    }
    for (const w of weekly ?? []) {
      if (w.plan && w.plan !== '<p></p>') candidates.push({ kind: 'weekly', id: w.id, text: `[주간계획/${w.category}] ${w.plan.replace(/<[^>]+>/g, ' ').trim().slice(0, 120)}` })
    }
    if (candidates.length === 0) return { ok: true, items: [] }

    // Gemini 키
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: metaRow } = await (admin as any).from('org_content').select('value').eq('key', 'META').single()
    const meta = (metaRow?.value as Record<string, unknown>) ?? {}
    const apiKey = meta.gemini_api_key as string | undefined
    const model = (meta.gemini_model as string | undefined) ?? DEFAULT_GEMINI_MODEL
    if (!apiKey) return { ok: false, error: 'Gemini API 키가 설정되지 않았습니다' }

    // 다음 주 월요일 기준
    const now = new Date()
    const day = now.getUTCDay()
    const toMon = ((8 - day) % 7) || 7
    const nextMon = new Date(now.getTime() + toMon * 864e5).toISOString().slice(0, 10) // kst-ok: AI 프롬프트용 "다음 주" 대략 앵커(저장값 아님)

    const prompt = `당신은 업무 일정 코치입니다. 아래 사용자의 미완료 업무·주간계획·미처리 메모를 보고, 다음 7일(${nextMon} 주) 동안 잡으면 좋을 "추천 일정"을 최대 5개 제안하세요.
각 항목: {"title":간결한 일정명, "start_at":"YYYY-MM-DDTHH:MM:00"(업무시간 09:00~18:00 내 합리적 배치), "reason":왜 추천하는지 한 줄, "link_kind":"daily|weekly|memo", "link_id":근거가 된 후보의 id}
순수 JSON 배열만 출력. 후보가 빈약하면 빈 배열.

후보:
${candidates.map((c) => `- id=${c.id} kind=${c.kind}: ${c.text}`).join('\n')}`

    const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }),
    })
    if (!res.ok) return { ok: false, error: `AI 호출 실패 (${res.status})` }
    const json = await res.json()
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
    let items: Recommendation[] = []
    try { items = JSON.parse(raw) } catch { items = [] }
    // 안전 필터 + datetime 정규화: Gemini가 내는 naive 벽시계(KST 의도)를 +09:00 앵커로 고정
    // → 등록 시 UTC로 정확히 적재(naive 저장 +9h 사고 차단, datetime SSOT).
    items = (Array.isArray(items) ? items : [])
      .filter((i) => i?.title && i?.start_at)
      .slice(0, 5)
      .map((i) => ({ ...i, start_at: normalizeKstWallString(i.start_at) }))
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '추천 실패' }
  }
}

export interface CalendarEventInput {
  title: string
  start_at: string
  end_at?: string | null
  all_day?: boolean
  description?: string | null
  link_kind?: 'daily' | 'weekly' | 'memo' | 'meeting' | null
  link_id?: string | null
  source?: 'user' | 'ai' | 'rule'
  rrule?: string | null
}

interface Result {
  ok: boolean
  id?: string
  error?: string
}

/** 일정 생성 — 작성 시점 소속 부서 자동 동결(계층 가시성용) */
export async function createCalendarEvent(input: CalendarEventInput): Promise<Result> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다' }
    if (!input.title?.trim()) return { ok: false, error: '제목을 입력하세요' }
    if (!input.start_at) return { ok: false, error: '시작 일시가 필요합니다' }

    // 현재 소속 부서 (org_nodes person.parent)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dept } = await (supabase.from('v_user_departments') as any)
      .select('department_id').eq('user_id', user.id).limit(1).maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('calendar_events') as any)
      .insert({
        user_id: user.id,
        department_id: dept?.department_id ?? null,
        title: input.title.trim(),
        description: input.description ?? null,
        start_at: input.start_at,
        end_at: input.end_at ?? null,
        all_day: input.all_day ?? false,
        rrule: input.rrule ?? null,
        source: input.source ?? 'user',
        link_kind: input.link_kind ?? null,
        link_id: input.link_id ?? null,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: `저장 실패: ${error.message}` }
    return { ok: true, id: data.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '저장 실패' }
  }
}

/**
 * 일정 수정 — **없던 기능이다.**
 *
 * 사용자 지시(2026-09-02): *"수정이 없으면 수정이 있어야지"*.
 * 예전에는 만들기(`createCalendarEvent`)와 지우기(`deleteCalendarEvent`)뿐이라,
 * 오타 하나를 고치려면 **지우고 다시 만들어야** 했다 — 그 사이 연동(link_kind)과
 * 반복 설정이 함께 사라진다.
 *
 * **쓰기는 본인만.** RLS `cal_write` 가 `user_id = auth.uid()` 로 이미 막지만,
 * 앱에서도 소유를 확인해 **「저장됐다」고 말한 뒤 아무 일도 안 일어나는 상태**를 없앤다
 * (RLS 는 남의 행을 못 찾을 뿐 오류를 주지 않는다 — 0행 갱신이 조용한 성공이 된다).
 *
 * **반복 일정은 시리즈 전체가 바뀐다.** 화면에 전개된 가짜 id(`<base>:<날짜>`)가 아니라
 * **원본 행 id(`base_id`)를 넘겨야 한다** — 삭제와 같은 규칙이다.
 */
export async function updateCalendarEvent(
  id: string,
  input: Omit<CalendarEventInput, 'link_kind' | 'link_id' | 'source'>,
): Promise<Result> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다' }
    if (!id) return { ok: false, error: '수정할 일정을 찾지 못했습니다' }
    if (!input.title?.trim()) return { ok: false, error: '제목을 입력하세요' }
    if (!input.start_at) return { ok: false, error: '시작 일시가 필요합니다' }

    // 소유 확인 — 남의 일정이면 조용히 0행이 되는 대신 이유를 말한다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: own } = await (supabase.from('calendar_events') as any)
      .select('user_id, link_kind').eq('id', id).maybeSingle()
    if (!own) return { ok: false, error: '일정을 찾지 못했습니다' }
    if (own.user_id !== user.id) return { ok: false, error: '내 일정만 수정할 수 있습니다' }
    /**
     * 자동 생성된 일정은 여기서 고치지 않는다 — 원본(일일업무·회의)이 진실이라
     * 제목만 바꾸면 **고칠 곳이 둘**이 되고 다음 동기화에 되돌아간다.
     */
    if (own.link_kind) {
      return { ok: false, error: '업무·회의에서 만들어진 일정입니다. 원본에서 수정하세요' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('calendar_events') as any)
      .update({
        title: input.title.trim(),
        description: input.description ?? null,
        start_at: input.start_at,
        end_at: input.end_at ?? null,
        all_day: input.all_day ?? false,
        rrule: input.rrule ?? null,
      })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) return { ok: false, error: `저장 실패: ${error.message}` }
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '저장 실패' }
  }
}

/**
 * 수정 폼을 채울 값 하나를 읽는다.
 *
 * 목록(`/api/calendar/events`)이 이미 주는 값이지만, **반복 일정은 전개된 사본**이라
 * 시각이 그 회차의 것이다. 원본을 고치려면 원본을 읽어야 한다.
 */
export async function getCalendarEvent(id: string): Promise<{
  ok: boolean
  error?: string
  event?: {
    id: string; title: string; description: string | null
    start_at: string; end_at: string | null; all_day: boolean; rrule: string | null
  }
}> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('calendar_events') as any)
      .select('id, title, description, start_at, end_at, all_day, rrule, user_id')
      .eq('id', id).maybeSingle()
    if (error) return { ok: false, error: '일정을 불러오지 못했습니다' }
    if (!data) return { ok: false, error: '일정을 찾지 못했습니다' }
    if (data.user_id !== user.id) return { ok: false, error: '내 일정만 수정할 수 있습니다' }
    return { ok: true, event: data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '일정을 불러오지 못했습니다' }
  }
}

/** 캘린더에 연결된 일일업무 1건의 요약 (인라인 배지 표시용) */
export interface LinkedDailyCalEntry {
  logId: string
  startAt: string | null
}

/**
 * 주어진 daily_log id 들 중 이미 캘린더(link_kind='daily')에 연결된 항목을 반환.
 * (일일 타임라인 카드 인라인 "📅 등록됨" 배지용 — 읽기 전용. start_at 동반 반환해 날짜 표기 가능)
 */
export async function getLinkedDailyLogIds(logIds: string[]): Promise<LinkedDailyCalEntry[]> {
  try {
    if (logIds.length === 0) return []
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('calendar_events') as any)
      .select('link_id, start_at')
      .eq('user_id', user.id)
      .eq('link_kind', 'daily')
      .in('link_id', logIds)
    return (data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => r.link_id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => ({ logId: r.link_id as string, startAt: (r.start_at as string) ?? null }))
  } catch {
    return []
  }
}

/**
 * 일일업무 일정 후보 1건을 캘린더에 추가 (P2 확정 액션 — 사용자 명시 호출 전용).
 * 동일 link_id(link_kind='daily')가 이미 있으면 재INSERT 하지 않고 알린다(중복 가드).
 */
export async function createDailyScheduleEvent(input: {
  title: string
  start_at: string
  link_id: string
}): Promise<Result & { duplicate?: boolean }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다' }

    // 중복 가드: 동일 link_id 가 이미 연결돼 있으면 스킵
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from('calendar_events') as any)
      .select('id')
      .eq('user_id', user.id)
      .eq('link_kind', 'daily')
      .eq('link_id', input.link_id)
      .limit(1)
      .maybeSingle()
    if (existing) return { ok: true, id: existing.id, duplicate: true }

    return await createCalendarEvent({
      title: input.title,
      start_at: input.start_at,
      link_kind: 'daily',
      link_id: input.link_id,
      source: 'rule',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '저장 실패' }
  }
}

/**
 * 특정 daily_log 에 연결된 캘린더 일정(link_kind='daily')을 모두 삭제한다.
 * ScheduleSection의 [취소] 및 deleteDailyLog cascade 에서 재사용. 본인(user_id) 행만 삭제.
 */
export async function unlinkDailyCalendar(logId: string): Promise<Result> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('calendar_events') as any)
      .delete()
      .eq('user_id', user.id)
      .eq('link_kind', 'daily')
      .eq('link_id', logId)
    if (error) return { ok: false, error: `삭제 실패: ${error.message}` }

    // 피드백 신호: 일정 자동등록 취소 = schedule_reject (best-effort)
    await recordFeedbackSignal(supabase, {
      userId: user.id,
      logId,
      signalType: 'schedule_reject',
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '삭제 실패' }
  }
}

export async function deleteCalendarEvent(id: string): Promise<Result> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '인증이 필요합니다' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('calendar_events') as any).delete().eq('id', id)
    if (error) return { ok: false, error: `삭제 실패: ${error.message}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '삭제 실패' }
  }
}
