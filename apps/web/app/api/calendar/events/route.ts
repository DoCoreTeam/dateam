import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isRealDate } from '@/lib/daily/calendar-scope'
import { listCalendarEventsInRange } from '@/lib/calendar/events-range'

// GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD
// 범위 내 일정 조회 (RLS: 본인 + 조직 계층), 반복은 펼친다. 계산은 lib/calendar/events-range 한 곳
export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start')
  const end = req.nextUrl.searchParams.get('end')
  // 꼴만 맞는 없는 날짜(2026-02-30)는 날짜 환산에서 RangeError 로 500 이 됐다, 400 으로 답한다
  if (!start || !end || !isRealDate(start) || !isRealDate(end)) {
    return NextResponse.json({ error: 'start·end(YYYY-MM-DD) 필요' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  try {
    return NextResponse.json(await listCalendarEventsInRange(supabase, user.id, start, end))
  } catch (e) {
    console.error('[api/calendar/events]', e)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }
}
