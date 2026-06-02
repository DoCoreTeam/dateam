'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'

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
    const model = (meta.gemini_model as string | undefined) ?? 'gemini-2.0-flash'
    if (!apiKey) return { ok: false, error: 'Gemini API 키가 설정되지 않았습니다' }

    // 다음 주 월요일 기준
    const now = new Date()
    const day = now.getUTCDay()
    const toMon = ((8 - day) % 7) || 7
    const nextMon = new Date(now.getTime() + toMon * 864e5).toISOString().slice(0, 10)

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
    // 안전 필터
    items = (Array.isArray(items) ? items : []).filter((i) => i?.title && i?.start_at).slice(0, 5)
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
