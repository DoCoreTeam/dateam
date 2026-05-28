import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DailyLog } from '@/types/database'

const DAY_LIMIT = 500

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date 파라미터 필요 (YYYY-MM-DD)' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data, error } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .eq('log_date', date)
    .order('logged_at', { ascending: true })
    .limit(DAY_LIMIT)

  if (error) {
    console.error('[api/daily/logs]', error)
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  }
  if (data?.length === DAY_LIMIT) console.warn('[api/daily/logs] limit reached')

  return NextResponse.json(data as DailyLog[], {
    headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
  })
}
