import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { EXCLUDE_RAW_HEAD_OR } from '@/lib/daily/raw-head'
import { htmlToPlain } from '@/lib/html-to-plain'
import { suggestProjects, type ProjectLogInput, type ProjectWeeklyInput } from '@/lib/gemini-suggest-projects'

// GET /api/work/projects/suggest — 본인 일일업무(+주간보고 맥락)를 AI가 읽어 "예상 프로젝트 후보" 제안.
//  ⚠️ 자동 생성 금지(§5-3). 후보 리스트만 반환 → 사용자가 확인 후 confirm 으로 생성.
//  방식: LLM 군집화(gemini-suggest-projects). 내용 기반이라 autolink 엔티티 링크 유무와 무관하게 동작.
//        (기존 구현은 work_entity_links(거래처/딜)에만 의존 → 링크가 없으면 항상 빈 결과였음)

const RECENT_LIMIT = 250        // 본인 최근 업무 스캔 상한(LIMIT 필수)
const WEEKS_BACK = 12           // 최근 12주
const WEEKLY_LIMIT = 80
const SAMPLE_MAX = 5            // 후보당 sampleLogIds 상한

interface Suggestion {
  suggestedName: string
  reason: string
  taskCount: number
  sampleLogIds: string[]
}

export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const user = auth.user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const start = new Date(); start.setDate(start.getDate() - WEEKS_BACK * 7)
  const startStr = start.toISOString().slice(0, 10)

  // 1) 본인 personal 일일업무 로드(id 포함 — ref 매핑/연결용)
  const { data: logs } = await db.from('daily_logs')
    .select('id, content, log_date')
    .eq('user_id', user.id).eq('task_kind', 'personal')
    .eq('is_onboarding', false)  // onboarding: AI 프로젝트 군집화 입력 — 실습 행 제외
    .or(EXCLUDE_RAW_HEAD_OR)     // 원문 raw 헤드(헤더 전용) 제외 — AI 군집 입력 원문 중복 방지
    .gte('log_date', startStr)
    .order('log_date', { ascending: false }).limit(RECENT_LIMIT)
  const logRows = ((logs ?? []) as Array<{ id: string; content: string; log_date: string }>)
    .filter((r) => (r.content ?? '').trim().length > 0)
  if (logRows.length === 0) return NextResponse.json({ suggestions: [] })

  // 2) ref(L1..) ↔ 실제 log id 매핑 — LLM엔 ref만 노출(id 유출/환각 방지)
  const refToId = new Map<string, string>()
  const logInput: ProjectLogInput[] = logRows.map((r, i) => {
    const ref = `L${i + 1}`
    refToId.set(ref, r.id)
    return { ref, content: r.content, log_date: r.log_date }
  })

  // 3) 주간보고(맥락 참고용) — Tiptap HTML → plain 변환(태그 누출 방지)
  const { data: weekly } = await db.from('weekly_reports')
    .select('category, performance, plan')
    .eq('user_id', user.id)
    .gte('week_start', startStr)
    .is('deleted_at', null)
    .limit(WEEKLY_LIMIT)
  const weeklyInput: ProjectWeeklyInput[] = ((weekly ?? []) as Array<{ category: string; performance: string; plan: string }>)
    .map((r) => ({ category: r.category ?? '', performance: htmlToPlain(r.performance ?? ''), plan: htmlToPlain(r.plan ?? '') }))

  // 4) 기존 프로젝트 이름(중복 제안 방지)
  const { data: projs } = await db.from('projects').select('name').eq('user_id', user.id).is('deleted_at', null).limit(200)
  const existingNames = ((projs ?? []) as Array<{ name: string }>).map((p) => p.name).filter(Boolean)
  const existingLower = new Set(existingNames.map((n) => n.toLowerCase().trim()))

  // 5) API 키(org_content META) — 사용자 데이터가 아니므로 admin으로 키만 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = (typeof meta.gemini_model === 'string' ? meta.gemini_model : '') || 'gemini-2.0-flash'
  if (!apiKey) return NextResponse.json({ suggestions: [], message: 'AI 키가 설정되지 않았습니다' })

  // 6) LLM 군집화 → ref를 실제 log id로 환원해 후보 구성
  try {
    const candidates = await suggestProjects(logInput, weeklyInput, existingNames, apiKey, model, user.id)
    const suggestions: Suggestion[] = candidates
      .filter((c) => !existingLower.has(c.suggestedName.toLowerCase().trim()))  // 이중 중복 가드
      .map((c) => {
        const ids = c.memberRefs.map((ref) => refToId.get(ref)).filter((x): x is string => !!x)
        if (ids.length < 2) return null
        return {
          suggestedName: c.suggestedName,
          reason: c.reason || `연관 업무 ${ids.length}건을 묶은 프로젝트 후보입니다`,
          taskCount: ids.length,
          sampleLogIds: ids.slice(0, SAMPLE_MAX),
        } as Suggestion
      })
      .filter((s): s is Suggestion => s !== null)
      .sort((a, b) => b.taskCount - a.taskCount)
    return NextResponse.json({ suggestions }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[work/projects/suggest]', e)
    // 실패 시 빈 후보로 우아하게 폴백(패널은 "묶을 만한 흐름 없음"으로 표시) — 500로 사용자 막지 않음
    return NextResponse.json({ suggestions: [] })
  }
}
