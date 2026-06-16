import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DailyLog } from '@/types/database'

const WEEK_LIMIT = 1000

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start')
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return NextResponse.json({ error: 'start 파라미터 필요 (YYYY-MM-DD)' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const endDate = new Date(start + 'T00:00:00')
  endDate.setDate(endDate.getDate() + 6)
  const end = endDate.toISOString().slice(0, 10)

  // personal=1: 일일 주간뷰 — 개인 업무만(부서업무 역류 제거). 미지정: 주간보고/캘린더 — 담당 부서업무 인용 포함(기존 동작 보존)
  const personalOnly = req.nextUrl.searchParams.get('personal') === '1'
  let q = (supabase.from('daily_logs') as any).select('*')
  if (personalOnly) {
    q = q.eq('user_id', user.id).eq('task_kind', 'personal')
  } else {
    q = q.or(`user_id.eq.${user.id},assignee_user_id.eq.${user.id}`)
  }
  const { data, error } = await q
    .or(`and(log_date.gte.${start},log_date.lte.${end}),and(target_date.gte.${start},target_date.lte.${end})`)
    .order('log_date', { ascending: true })
    .order('logged_at', { ascending: true })
    .limit(WEEK_LIMIT)

  if (error) {
    console.error('[api/daily/week]', error)
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  }
  if (data?.length === WEEK_LIMIT) console.warn('[api/daily/week] limit reached')

  return NextResponse.json(data as DailyLog[], {
    headers: { 'Cache-Control': 'no-store' },
  })
}
