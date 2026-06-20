'use server'

import { createHash } from 'node:crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { mergeAndRefineByCategory, type MergedCategoryReport } from '@/lib/gemini-refine'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'
import { prevWeekStart } from '@/lib/week'
import { computeDeptTimeliness } from '@/lib/weekly-report/timeliness-server'
import { formatKst, formatDelay } from '@/lib/weekly-report/timeliness'
import { TIMELINESS_COLORS } from '@/lib/tokens/status-colors'

/** dept body(jsonb) → MergedCategoryReport[] 안전 정규화 */
function normalizeBody(raw: unknown): MergedCategoryReport[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((it) => {
      const r = (typeof it === 'object' && it !== null ? it : {}) as Record<string, unknown>
      return {
        category: typeof r.category === 'string' ? r.category : '',
        performance: typeof r.performance === 'string' ? r.performance : '',
        plan: typeof r.plan === 'string' ? r.plan : '',
        issues: typeof r.issues === 'string' ? r.issues : '',
      }
    })
    .filter((r) => r.category !== '')
}

interface ActionResult {
  ok: boolean
  error?: string
  body?: unknown[]
  status?: 'draft' | 'confirmed'
}

interface MemberReportRow {
  user_id: string
  category: string
  performance: string
  plan: string
  issues: string
  profiles: { name: string } | null
}

async function authedAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, admin: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { user, admin: createAdminClient() as any }
}

function bodyHash(rows: MemberReportRow[]): string {
  const norm = rows
    .map((r) => `${r.user_id}|${r.category}|${r.performance}|${r.plan}|${r.issues}`)
    .sort()
    .join('\n')
  return createHash('sha1').update(norm).digest('hex')
}

/** 부서 취합 실행: 부서원 원본 → AI 병합 → dept_weekly_reports draft 스냅샷 저장 */
export async function aggregateDept(deptId: string, weekStart: string): Promise<ActionResult> {
  try {
    const { user, admin } = await authedAdmin()
    if (!user) return { ok: false, error: '인증이 필요합니다' }

    const scope = await resolveOrgScope(admin, user.id)
    if (!scope.editableDeptIds.includes(deptId)) {
      return { ok: false, error: '이 부서를 취합할 권한이 없습니다' }
    }

    const memberIds = deptMemberUserIds(scope, deptId)
    if (memberIds.length === 0) return { ok: false, error: '부서원이 없습니다' }

    const { data: raw } = await admin
      .from('weekly_reports')
      .select('user_id, category, performance, plan, issues, profiles(name)')
      .in('user_id', memberIds)
      .eq('week_start', weekStart)
      .is('deleted_at', null) as { data: MemberReportRow[] | null }

    const rows = raw ?? []
    if (rows.length === 0) return { ok: false, error: '해당 주차에 부서원 보고가 없습니다' }

    // Gemini 키 (org_content META)
    const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
    const meta = (metaRow?.value as Record<string, unknown>) ?? {}
    const apiKey = meta.gemini_api_key as string | undefined
    const model = (meta.gemini_model as string | undefined) ?? 'gemini-2.0-flash'
    if (!apiKey) return { ok: false, error: 'Gemini API 키가 설정되지 않았습니다' }

    // 보수: 지난주 취합본(구분·계획 기준)과 현재 편집본을 읽어 병합·보존 컨텍스트로 주입한다.
    //  ① 지난주 구분 → 통일 기준  ② 지난주 계획 → 성과 이행  ③ 기존 편집본 → 주제 병합·보존
    const [prevRes, curRes] = await Promise.all([
      admin.from('dept_weekly_reports').select('body')
        .eq('department_id', deptId).eq('week_start', prevWeekStart(weekStart)).maybeSingle(),
      admin.from('dept_weekly_reports').select('body, status')
        .eq('department_id', deptId).eq('week_start', weekStart).maybeSingle(),
    ])
    const prevBody = normalizeBody(prevRes.data?.body)
    const existingBody = normalizeBody(curRes.data?.body)
    const existingStatus = (curRes.data?.status as 'draft' | 'confirmed' | undefined) ?? null

    const prevCategories = Array.from(new Set(prevBody.map((r) => r.category).filter(Boolean)))
    const prevPlans = prevBody
      .filter((r) => r.plan && r.plan.trim() !== '' && r.plan.trim() !== '-')
      .map((r) => ({ category: r.category, plan: r.plan }))

    const merged = await mergeAndRefineByCategory(
      rows.map((r) => ({
        userName: r.profiles?.name ?? '익명',
        category: r.category,
        performance: r.performance,
        plan: r.plan,
        issues: r.issues,
      })),
      apiKey,
      model,
      user.id,
      {
        prevCategories: prevCategories.length > 0 ? prevCategories : undefined,
        prevPlans: prevPlans.length > 0 ? prevPlans : undefined,
        existingBody: existingBody.length > 0 ? existingBody : undefined,
      },
    )

    // 기존 status 보존: 이미 confirmed면 유지(임의 draft 리셋 금지). 신규면 draft.
    const nextStatus: 'draft' | 'confirmed' = existingStatus ?? 'draft'

    const hash = bodyHash(rows)
    const { error } = await admin.from('dept_weekly_reports').upsert(
      {
        department_id: deptId,
        week_start: weekStart,
        body: merged,
        source_hash: hash,
        status: nextStatus,
        edited_by: user.id,
      },
      { onConflict: 'department_id,week_start' },
    )
    if (error) return { ok: false, error: `저장 실패: ${error.message}` }
    return { ok: true, body: merged, status: nextStatus }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '취합 실패' }
  }
}

/** 부서장이 편집한 취합본 저장 (draft 유지 또는 confirmed 확정) */
export async function saveDeptReport(
  deptId: string,
  weekStart: string,
  body: unknown[],
  confirm: boolean,
): Promise<ActionResult> {
  try {
    const { user, admin } = await authedAdmin()
    if (!user) return { ok: false, error: '인증이 필요합니다' }

    const scope = await resolveOrgScope(admin, user.id)
    if (!scope.editableDeptIds.includes(deptId)) {
      return { ok: false, error: '이 부서를 편집할 권한이 없습니다' }
    }

    const status = confirm ? 'confirmed' : 'draft'
    // 취합 확정 시 confirmed_at(취합 기준선, 최신값)·confirmed_by 기록.
    // draft 저장 시엔 두 필드를 upsert에 넣지 않음 → 기존 확정 시각 보존(임의 리셋 금지).
    const row: Record<string, unknown> = {
      department_id: deptId, week_start: weekStart, body, status, edited_by: user.id,
    }
    if (confirm) {
      row.confirmed_at = new Date().toISOString()
      row.confirmed_by = user.id
    }
    const { error } = await admin.from('dept_weekly_reports').upsert(
      row,
      { onConflict: 'department_id,week_start' },
    )
    if (error) return { ok: false, error: `저장 실패: ${error.message}` }
    return { ok: true, body, status }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '저장 실패' }
  }
}

/** 평가 증빙: 전 부서 주간보고 적시성 CSV. admin 전용. */
export async function exportTimelinessCsv(
  weekStart: string,
): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  try {
    const { user, admin } = await authedAdmin()
    if (!user) return { ok: false, error: '인증이 필요합니다' }

    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (prof?.role !== 'admin') return { ok: false, error: '관리자만 내보낼 수 있습니다' }

    // 입력 검증: weekStart = 월요일(YYYY-MM-DD)만 허용
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) {
      return { ok: false, error: '잘못된 주차입니다' }
    }

    const scope = await resolveOrgScope(admin, user.id)
    const deptIds = scope.nodes.filter((n) => n.type === 'department').map((n) => n.id)
    const tl = await computeDeptTimeliness(admin, scope, deptIds, weekStart)
    const deptName = new Map(scope.nodes.map((n) => [n.id, n.name]))

    // CSV 수식 인젝션 차단: =,+,-,@,TAB,CR 로 시작하는 셀에 ' prefix (OWASP) + 따옴표 이스케이프
    const esc = (s: string) => {
      let v = String(s)
      if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
      return `"${v.replace(/"/g, '""')}"`
    }
    const lines = [['부서', '이름', '상태', '지연', '최초작성', '최종작성', '취합시각'].map(esc).join(',')]
    for (const [deptId, members] of Object.entries(tl)) {
      for (const m of members) {
        lines.push([
          deptName.get(deptId) ?? deptId, m.name, TIMELINESS_COLORS[m.status].label,
          formatDelay(m.delayMinutes), formatKst(m.firstAt), formatKst(m.lastAt), formatKst(m.confirmedAt),
        ].map(esc).join(','))
      }
    }
    return { ok: true, csv: '﻿' + lines.join('\n') } // BOM → Excel 한글 깨짐 방지
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '내보내기 실패' }
  }
}
