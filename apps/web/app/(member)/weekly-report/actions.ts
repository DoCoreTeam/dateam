'use server'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

type WeeklyReportInsert = Database['public']['Tables']['weekly_reports']['Insert']

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
  const rows: WeeklyReportInsert[] = []

  for (let i = 0; i < rowCount; i++) {
    const category = (formData.get(`row_category_${i}`) as string)?.trim()
    const performance = (formData.get(`row_performance_${i}`) as string) || ''
    const plan = (formData.get(`row_plan_${i}`) as string) || ''
    const issues = (formData.get(`row_issues_${i}`) as string) || ''

    if (!category || (!performance && !plan && !issues)) continue

    rows.push({ user_id: user.id, week_start: weekStart, category, performance, plan, issues, deleted_at: null })
  }

  if (rows.length === 0) {
    return { ok: false, error: '최소 하나의 항목을 입력해주세요' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weekly_reports') as any).upsert(rows, {
    onConflict: 'user_id,week_start,category',
  })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/weekly-report')
  return { ok: true }
}

export async function deleteWeeklyReport(
  weekStart: string,
  category: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '인증이 필요합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weekly_reports') as any)
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('week_start', weekStart)
    .eq('category', category)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/weekly-report')
  return { ok: true }
}
