import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD
// 범위 내 일정 조회 (RLS: 본인 + 조직 계층). 반복(rrule) 전개는 P4.
export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start')
  const end = req.nextUrl.searchParams.get('end')
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: 'start·end(YYYY-MM-DD) 필요' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  // start_at이 [start 00:00, end 23:59:59] 범위에 걸치는 일정
  const from = `${start}T00:00:00`
  const to = `${end}T23:59:59`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('calendar_events') as any)
    .select('id, title, description, start_at, end_at, all_day, source, link_kind, link_id, status, user_id')
    .gte('start_at', from)
    .lte('start_at', to)
    .order('start_at', { ascending: true })
    .limit(1000)

  if (error) {
    console.error('[api/calendar/events]', error)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}
