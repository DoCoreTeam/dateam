'use server'

import { createHash } from 'node:crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { mergeAndRefineByCategory } from '@/lib/gemini-refine'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'

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
    )

    const hash = bodyHash(rows)
    const { error } = await admin.from('dept_weekly_reports').upsert(
      {
        department_id: deptId,
        week_start: weekStart,
        body: merged,
        source_hash: hash,
        status: 'draft',
        edited_by: user.id,
      },
      { onConflict: 'department_id,week_start' },
    )
    if (error) return { ok: false, error: `저장 실패: ${error.message}` }
    return { ok: true, body: merged, status: 'draft' }
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
    const { error } = await admin.from('dept_weekly_reports').upsert(
      { department_id: deptId, week_start: weekStart, body, status, edited_by: user.id },
      { onConflict: 'department_id,week_start' },
    )
    if (error) return { ok: false, error: `저장 실패: ${error.message}` }
    return { ok: true, body, status }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '저장 실패' }
  }
}
