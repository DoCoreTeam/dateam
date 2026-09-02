import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DailyLog } from '@/types/database'
import { CALENDAR_SCOPE, applyCalendarScopeFilters, calendarDayOr, isRealDate } from '@/lib/daily/calendar-scope'

const DAY_LIMIT = 500

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  // 형식만 보면 2026-02-30 같은 없는 날이 통과해 DB 에서 터진다(500). 잘못된 요청은 400 으로 답한다.
  if (!date || !isRealDate(date)) {
    return NextResponse.json({ error: 'date 파라미터 필요 (실재하는 YYYY-MM-DD)' }, { status: 400 })
  }
  /**
   * `scope=calendar` — 캘린더 칸과 **같은 판정**으로 하루를 조회한다(`lib/daily/calendar-scope`).
   * 기본값(미지정)은 일일 화면용으로 예전 그대로다 — 추가만 하고 기존 동작은 건드리지 않는다.
   * 이 갈래가 없으면 칸에는 뜨는 부서업무·기간 업무를 패널이 못 찾아 「기록이 없어요」가 뜬다.
   */
  const isCalendarScope = req.nextUrl.searchParams.get('scope') === CALENDAR_SCOPE

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)

  const scoped = isCalendarScope
    ? applyCalendarScopeFilters(base).or(calendarDayOr(date))
    // 온보딩(is_onboarding) 비격리 의도 — 본인 당일 목록은 등록 직후 "내가 등록함" 체감을 위해
    // 실습 행도 노출한다(DECISION #2). 파생/집계(주간·이월·캘린더·검색)에서만 격리. 필터 추가 금지.
    : base
        .eq('task_kind', 'personal')   // 일일 화면=개인 업무만. 부서업무(dept_task) 역류 제거
        .or(`log_date.eq.${date},target_date.eq.${date}`)

  const { data, error } = await scoped
    .order('logged_at', { ascending: true })
    .limit(DAY_LIMIT)

  if (error) {
    console.error('[api/daily/logs]', error)
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  }
  if (data?.length === DAY_LIMIT) console.warn('[api/daily/logs] limit reached')

  return NextResponse.json(data as DailyLog[], {
    headers: { 'Cache-Control': 'no-store' },
  })
}
