'use server'

import { createClient } from '@/lib/supabase/server'

export interface CalendarEventInput {
  title: string
  start_at: string
  end_at?: string | null
  all_day?: boolean
  description?: string | null
  link_kind?: 'daily' | 'weekly' | 'memo' | null
  link_id?: string | null
  source?: 'user' | 'ai' | 'rule'
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
