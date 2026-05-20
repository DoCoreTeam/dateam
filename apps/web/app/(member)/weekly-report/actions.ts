'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function upsertWeeklyReport(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const weekStart = formData.get('week_start') as string
  const category = formData.get('category') as string
  const performance = formData.get('performance') as string
  const plan = formData.get('plan') as string
  const issues = formData.get('issues') as string

  if (!weekStart || !category) {
    redirect('/weekly-report?error=주차와 구분을 선택해주세요')
  }

  // 같은 주차 + 구분이면 update, 아니면 insert (upsert)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weekly_reports') as any).upsert(
    {
      user_id: user.id,
      week_start: weekStart,
      category,
      performance: performance || '',
      plan: plan || '',
      issues: issues || '',
    },
    {
      onConflict: 'user_id,week_start,category',
    }
  )

  if (error) redirect(`/weekly-report?error=${encodeURIComponent((error as { message: string }).message)}`)

  revalidatePath('/weekly-report')
  redirect('/weekly-report?success=1')
}
