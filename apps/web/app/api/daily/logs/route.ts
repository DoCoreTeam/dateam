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

  // 온보딩(is_onboarding) 비격리 의도 — 본인 당일 목록은 등록 직후 "내가 등록함" 체감을 위해
  // 실습 행도 노출한다(DECISION #2). 파생/집계(주간·이월·캘린더·검색)에서만 격리. 필터 추가 금지.
  const { data, error } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .eq('task_kind', 'personal')   // 일일 화면=개인 업무만. 부서업무(dept_task) 역류 제거
    .or(`log_date.eq.${date},target_date.eq.${date}`)
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
