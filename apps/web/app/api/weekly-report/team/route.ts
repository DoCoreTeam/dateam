import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface TeamRow {
  user_id: string
  category: string
  performance: string
  plan: string
  issues: string
  week_start: string
  profiles: { name: string } | null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const week = searchParams.get('week')

  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ error: '유효한 week 파라미터 필요 (YYYY-MM-DD)' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('weekly_reports')
    .select('user_id, category, performance, plan, issues, week_start, profiles(name)')
    .eq('week_start', week)
    .is('deleted_at', null)
    .order('category', { ascending: true }) as unknown as { data: TeamRow[] | null; error: { message: string } | null }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const reports = (data ?? []).map((r) => ({
    userId: r.user_id,
    userName: r.profiles?.name ?? '알 수 없음',
    category: r.category,
    performance: r.performance,
    plan: r.plan,
    issues: r.issues,
    weekStart: r.week_start,
  }))

  return NextResponse.json(reports)
}
