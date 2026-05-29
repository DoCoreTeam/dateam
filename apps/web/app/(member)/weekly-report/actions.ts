'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import sanitizeHtml from 'sanitize-html'

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'code', 'pre', 'blockquote', 'br', 'span', 'mark', 'hr'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['style'],
    mark: ['data-color', 'style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
}

function sanitize(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTS)
}

export async function upsertWeeklyReport(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const weekStart = formData.get('week_start') as string

  if (!weekStart) {
    return { ok: false, error: '주차를 선택해주세요' }
  }

  const rowCount = Math.min(Math.max(0, Number(formData.get('row_count') ?? 0)), 50)
  // category가 중복되면 마지막 행 우선 (Map으로 dedup — UNIQUE 제약 위반 방지)
  const rowMap = new Map<string, { performance: string; plan: string; issues: string }>()

  for (let i = 0; i < rowCount; i++) {
    const category = (formData.get(`row_category_${i}`) as string)?.trim()
    const performance = sanitize((formData.get(`row_performance_${i}`) as string) || '')
    const plan = sanitize((formData.get(`row_plan_${i}`) as string) || '')
    const issues = sanitize((formData.get(`row_issues_${i}`) as string) || '')

    if (!category || (!performance && !plan && !issues)) continue

    rowMap.set(category, { performance, plan, issues })
  }

  if (rowMap.size === 0) {
    return { ok: false, error: '최소 하나의 항목을 입력해주세요' }
  }

  const rows = Array.from(rowMap.entries()).map(([category, fields]) => ({
    category,
    performance: fields.performance,
    plan: fields.plan,
    issues: fields.issues,
  }))

  // replace_weekly_report RPC: DELETE + INSERT를 단일 트랜잭션으로 실행 (migration 033)
  // 분리된 2-step으로 하면 DELETE 성공 후 INSERT 실패 시 해당 주차 데이터 전소실 위험이 있음
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('replace_weekly_report', {
    p_week_start: weekStart,
    p_rows: JSON.stringify(rows),
  })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/weekly-report')
  return { ok: true }
}

// hard DELETE 사용 이유:
// Migration 002 SELECT policy = USING (deleted_at IS NULL). PostgREST의 default
// return=representation 헤더로 인해 UPDATE 후 RETURNING이 SELECT policy를 통과해야 하는데,
// soft-delete로 deleted_at을 설정하면 바로 그 조건을 위반 → RLS 에러.
// DELETE policy는 WITH CHECK 없이 USING만 검사하므로 충돌 없음.
export async function deleteAllWeeklyReports(
  weekStart: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!weekStart) return { ok: false, error: '주차가 필요합니다' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '인증이 필요합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weekly_reports') as any)
    .delete()
    .eq('user_id', user.id)
    .eq('week_start', weekStart)

  if (error) {
    console.error('[deleteAllWeeklyReports]', error)
    return { ok: false, error: '삭제 중 오류가 발생했습니다' }
  }

  revalidatePath('/weekly-report')
  return { ok: true }
}

export async function deleteWeeklyReport(
  weekStart: string,
  category: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!weekStart || !category) return { ok: false, error: '주차와 구분이 필요합니다' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '인증이 필요합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weekly_reports') as any)
    .delete()
    .eq('user_id', user.id)
    .eq('week_start', weekStart)
    .eq('category', category)

  if (error) {
    console.error('[deleteWeeklyReport]', error)
    return { ok: false, error: '삭제 중 오류가 발생했습니다' }
  }

  revalidatePath('/weekly-report')
  return { ok: true }
}
