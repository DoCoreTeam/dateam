import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'
import { EXCLUDE_RAW_HEAD_OR } from '@/lib/daily/raw-head'
import { suggestDeptTasks } from '@/lib/gemini-suggest-tasks'
import { htmlToPlain } from '@/lib/html-to-plain'

// AI 부서업무 후보 추출: 일일업무+주간보고(org-scope 범위) → 후보 배열 반환.
// 수동 트리거 전용. 권한: scope='dept'는 부서장(editable/executive)만. 비용: 기간 캡(최대 4주)+상태필터.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { scope?: string; departmentId?: string; weeks?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const weeks = Math.min(Math.max(Number(body.weeks) || 2, 1), 4) // 1~4주 캡
  const scope = body.scope === 'dept' ? 'dept' : 'mine'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const orgScope = await resolveOrgScope(admin, user.id)

  // 대상 user_ids 결정 (org-scope 권한)
  let userIds: string[] = [user.id]
  let departmentId: string | null = null
  if (scope === 'dept') {
    const deptId = body.departmentId
    if (!deptId) return NextResponse.json({ error: '부서를 선택해 주세요' }, { status: 400 })
    const allowed = orgScope.isExecutive || orgScope.editableDeptIds.includes(deptId)
    if (!allowed) return NextResponse.json({ error: '이 부서의 업무를 추출할 권한이 없습니다' }, { status: 403 })
    userIds = deptMemberUserIds(orgScope, deptId)
    departmentId = deptId
    if (userIds.length === 0) return NextResponse.json({ error: '부서원이 없습니다' }, { status: 400 })
  }

  const start = new Date(); start.setDate(start.getDate() - weeks * 7)
  const startStr = start.toISOString().slice(0, 10)

  // 일일업무(개인 로그, 진행/예정/블로커만 — done 제외로 토큰 절감)
  const { data: logs } = await admin
    .from('daily_logs')
    .select('content, log_date, user_id')
    .in('user_id', userIds)
    .is('deleted_at', null)
    .eq('task_kind', 'personal')
    .eq('is_onboarding', false)  // onboarding: AI 부서업무 후보 입력(교차사용자 집계) — 실습 행 제외
    .or(EXCLUDE_RAW_HEAD_OR)     // 원문 raw 헤드(헤더 전용) 제외 — AI 입력 원문 중복 방지
    .in('entry_type', ['doing', 'planned', 'blocker'])
    .gte('log_date', startStr)
    .limit(400)

  // 주간보고
  const { data: weekly } = await admin
    .from('weekly_reports')
    .select('category, performance, plan, user_id')
    .in('user_id', userIds)
    .gte('week_start', startStr)
    .is('deleted_at', null)
    .limit(200)

  // 기존 부서업무 제목 (dedup용) — 등록 대상 부서 기준(mine 스코프도 선택 부서로 중복 감지)
  const dedupeDeptId = departmentId ?? (typeof body.departmentId === 'string' ? body.departmentId : null)
  let existingTitles: string[] = []
  if (dedupeDeptId) {
    const { data: ex } = await admin
      .from('daily_logs').select('content').eq('task_kind', 'dept_task').is('deleted_at', null).eq('department_id', dedupeDeptId).limit(200)
    existingTitles = ((ex ?? []) as { content: string }[]).map((r) => r.content)
  }

  // 이름 맵(author 표시용)
  const ids = Array.from(new Set([...(logs ?? []), ...(weekly ?? [])].map((r: { user_id: string }) => r.user_id)))
  const { data: profs } = ids.length
    ? await admin.from('profiles').select('id,name').in('id', ids)
    : { data: [] }
  const nameMap: Record<string, string> = Object.fromEntries(((profs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))

  const logInput = ((logs ?? []) as { content: string; log_date: string; user_id: string }[])
    .map((r) => ({ content: r.content, log_date: r.log_date, author: nameMap[r.user_id] }))
  const weeklyInput = ((weekly ?? []) as { category: string; performance: string; plan: string; user_id: string }[])
    // 주간보고는 Tiptap HTML 저장 → AI 입력 전 plain 변환(HTML 태그가 source_quote로 새는 것 방지)
    .map((r) => ({ category: r.category, performance: htmlToPlain(r.performance), plan: htmlToPlain(r.plan), author: nameMap[r.user_id] }))

  if (logInput.length === 0 && weeklyInput.length === 0) {
    return NextResponse.json({ candidates: [], message: '해당 기간 데이터가 없습니다' })
  }

  // API 키
  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = (typeof meta.gemini_model === 'string' ? meta.gemini_model : '') || 'gemini-2.0-flash'
  if (!apiKey) return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다' }, { status: 400 })

  try {
    const candidates = await suggestDeptTasks(logInput, weeklyInput, existingTitles, apiKey, model, user.id)
    return NextResponse.json({ candidates }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[suggest-dept-tasks]', e)
    return NextResponse.json({ error: 'AI 추출에 실패했습니다. 다시 시도해 주세요.' }, { status: 500 })
  }
}
