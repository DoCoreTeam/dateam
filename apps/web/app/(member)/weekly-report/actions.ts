'use server'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { CATEGORIES } from './constants'

type WeeklyReportInsert = Database['public']['Tables']['weekly_reports']['Insert']

export async function upsertWeeklyReport(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const weekStart = formData.get('week_start') as string

  if (!weekStart) {
    redirect(`/weekly-report?error=${encodeURIComponent('주차를 선택해주세요')}`)
  }

  const rows: WeeklyReportInsert[] = CATEGORIES.map((category) => ({
    user_id: user.id,
    week_start: weekStart,
    category,
    performance: (formData.get(`${category}_performance`) as string) || '',
    plan: (formData.get(`${category}_plan`) as string) || '',
    issues: (formData.get(`${category}_issues`) as string) || '',
    deleted_at: null,
  })).filter((r) => r.performance || r.plan || r.issues)

  if (rows.length === 0) {
    redirect(`/weekly-report?error=${encodeURIComponent('최소 하나의 항목을 입력해주세요')}`)
  }

  // rows는 WeeklyReportInsert[]로 타입 안전하게 구성됨.
  // @supabase/ssr 제네릭이 upsert 파라미터를 never[]로 추론하는 한계로 from() 캐스팅 필요.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weekly_reports') as any).upsert(rows, {
    onConflict: 'user_id,week_start,category',
  })

  if (error) redirect(`/weekly-report?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/weekly-report')
  redirect('/weekly-report?success=1')
}
