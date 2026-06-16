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

  const fromMs = new Date(`${start}T00:00:00Z`).getTime()
  const toMs = new Date(`${end}T23:59:59Z`).getTime()

  // 단발: 범위 내 시작 / 반복: 시작이 범위 끝 이전이면 후보 (전개는 아래)
  // 하한(start)을 추가해 과거 전체 스캔 방지 — 단, 반복(rrule)은 시작이 범위 이전이어도
  // 범위 내 occurrence를 만들 수 있어 하한에서 제외(rrule is not null로 보존).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('calendar_events') as any)
    .select('id, title, description, start_at, end_at, all_day, source, link_kind, link_id, status, user_id, rrule')
    .lte('start_at', `${end}T23:59:59`)
    .or(`start_at.gte.${start}T00:00:00,rrule.not.is.null`)
    .order('start_at', { ascending: true })
    .limit(1000)

  if (error) {
    console.error('[api/calendar/events]', error)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }

  // 반복 전개 (FREQ=DAILY / WEEKLY 단순 지원)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = []
  for (const ev of data ?? []) {
    const baseMs = new Date(ev.start_at).getTime()
    if (!ev.rrule) {
      if (baseMs >= fromMs && baseMs <= toMs) out.push({ ...ev, base_id: ev.id })
      continue
    }
    const stepDays = /FREQ=WEEKLY/i.test(ev.rrule) ? 7 : 1
    const stepMs = stepDays * 864e5
    let occ = baseMs
    let guard = 0
    while (occ <= toMs && guard < 400) {
      if (occ >= fromMs) {
        const iso = new Date(occ).toISOString()
        out.push({ ...ev, id: `${ev.id}:${iso.slice(0, 10)}`, base_id: ev.id, start_at: iso })
      }
      occ += stepMs
      guard++
    }
  }
  out.sort((a, b) => (a.start_at < b.start_at ? -1 : 1))
  return NextResponse.json(out)
}
