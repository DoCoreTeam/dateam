import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DailyLog, MemoStatus } from '@/types/database'

const PAGE_SIZE = 30

// GET /api/daily/memos?status=unreviewed|all&cursor=<iso>
// note 전용, logged_at DESC (타임스탬프 정렬)
export async function GET(req: NextRequest) {
  const statusParam = req.nextUrl.searchParams.get('status') ?? 'all'
  const cursor = req.nextUrl.searchParams.get('cursor') // logged_at ISO, 이보다 과거만

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  // 온보딩(is_onboarding) 비격리 의도 — 본인 메모 목록은 실습 행도 노출(DECISION #2). 필터 추가 금지.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('daily_logs') as any)
    .select('id, content, logged_at, log_date, memo_status, memo_reviewed_at, linked_account_id, linked_contact_id, entry_type')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .eq('entry_type', 'note')
    .order('logged_at', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (statusParam === 'unreviewed') {
    q = q.in('memo_status', ['new'])
  } else if (statusParam === 'reviewed') {
    q = q.eq('memo_status', 'reviewed')
  } else if (statusParam === 'actioned') {
    q = q.eq('memo_status', 'actioned')
  }

  if (cursor) q = q.lt('logged_at', cursor)

  const { data, error } = await q
  if (error) {
    console.error('[api/daily/memos]', error)
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  }

  const rows = (data ?? []) as Partial<DailyLog>[]
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? page[page.length - 1]?.logged_at ?? null : null

  // 숙성도(staleness) 부여: logged_at 기준 경과일
  const now = Date.now()
  const items = page.map((m) => {
    const ageDays = m.logged_at ? Math.floor((now - new Date(m.logged_at).getTime()) / 86400000) : 0
    const staleness = ageDays >= 4 ? 'stale' : ageDays >= 2 ? 'aging' : 'fresh'
    return { ...m, ageDays, staleness }
  })

  return NextResponse.json(
    { items, nextCursor, hasMore },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

export type MemoListItem = Partial<DailyLog> & {
  ageDays: number
  staleness: 'fresh' | 'aging' | 'stale'
  memo_status: MemoStatus | null
}
