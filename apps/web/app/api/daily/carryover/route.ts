import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DailyLog } from '@/types/database'

const CARRYOVER_LIMIT = 100

export async function GET(req: NextRequest) {
  const today = req.nextUrl.searchParams.get('today')
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return NextResponse.json({ error: 'today 파라미터 필요 (YYYY-MM-DD)' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const sevenDaysAgo = new Date(today + 'T00:00:00')
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const from = sevenDaysAgo.toISOString().slice(0, 10)

  const { data, error } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .eq('task_kind', 'personal')   // 이월도 개인 업무만 (부서업무 역류 제거)
    .eq('is_onboarding', false)    // 온보딩 실습 행 제외(이월 제안 오염 방지)
    .eq('is_resolved', false)
    .in('entry_type', ['planned', 'doing', 'blocker'])
    .gte('log_date', from)
    .lt('log_date', today)
    .order('log_date', { ascending: false })
    .order('logged_at', { ascending: true })
    .limit(CARRYOVER_LIMIT)

  if (error) {
    console.error('[api/daily/carryover]', error)
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  }
  if (data?.length === CARRYOVER_LIMIT) console.warn('[api/daily/carryover] limit reached')

  return NextResponse.json(data as DailyLog[], {
    headers: { 'Cache-Control': 'no-store' },
  })
}
