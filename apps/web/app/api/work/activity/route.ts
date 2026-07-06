import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ActivityFeedItem, ActivityStatus, FeedModule } from '@/lib/work/activity-log'

// GET /api/work/activity — 업무 허브 통합 이력 피드.
// 세 소스(activity_log[일일/부서] + project_activity[프로젝트] + weekly_report_activity[주간])를
// occurred_at 커서(before) 기반으로 조회 → 공통 shape 정규화 → 최신순 병합 → limit만큼 반환.
// 커서 방식이라 소스별 상한(캡) 없이 과거까지 완전 열람 가능(감사 완전성). RLS가 소유 스코프 강제.
// 필터: module[](daily|dept_task|project|weekly), status(success|failure|partial).

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

function pickTitle(after: Record<string, unknown> | null, evidence: Record<string, unknown> | null): string | null {
  if (after && typeof after.name === 'string') return after.name
  if (after && typeof after.content === 'string') return after.content
  if (evidence && typeof evidence.name === 'string') return evidence.name
  return null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT))
  const before = sp.get('before')   // occurred_at ISO 커서(이전 페이지 마지막 항목보다 과거만)
  const modulesRaw = sp.getAll('module').filter(Boolean)
  const wantModule = (m: FeedModule) => modulesRaw.length === 0 || modulesRaw.includes(m)
  const statusRaw = sp.get('status')
  const statusFilter: ActivityStatus | null =
    statusRaw === 'success' || statusRaw === 'failure' || statusRaw === 'partial' ? statusRaw : null

  // 각 소스는 limit+1개(커서 이전)만 가져옴 → 병합 후 slice. 남는 과거 항목은 다음 커서로 재조회됨.
  const FETCH = limit + 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const items: ActivityFeedItem[] = []

  // 1) activity_log (일일/부서)
  const tableMods = (['daily', 'dept_task'] as FeedModule[]).filter(wantModule)
  if (tableMods.length > 0) {
    let q = db.from('activity_log')
      .select('id, module, action, status, title, after_snapshot, error_detail, occurred_at')
      .in('module', tableMods)
      .order('occurred_at', { ascending: false }).limit(FETCH)
    if (before) q = q.lt('occurred_at', before)
    if (statusFilter) q = q.eq('status', statusFilter)
    const { data } = await q
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      items.push({
        id: `al_${r.id}`, module: r.module as FeedModule, action: String(r.action), status: r.status as ActivityStatus,
        title: (r.title as string) ?? null, occurredAt: String(r.occurred_at),
        after: (r.after_snapshot as Record<string, unknown>) ?? null,
        error: (r.error_detail as ActivityFeedItem['error']) ?? null,
      })
    }
  }

  // 2) project_activity (프로젝트)
  if (wantModule('project')) {
    let q = db.from('project_activity')
      .select('id, action, status, after_snapshot, error_detail, evidence, occurred_at')
      .order('occurred_at', { ascending: false }).limit(FETCH)
    if (before) q = q.lt('occurred_at', before)
    if (statusFilter) q = q.eq('status', statusFilter)
    const { data } = await q
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const after = (r.after_snapshot as Record<string, unknown>) ?? null
      items.push({
        id: `pa_${r.id}`, module: 'project', action: String(r.action), status: r.status as ActivityStatus,
        title: pickTitle(after, (r.evidence as Record<string, unknown>) ?? null),
        occurredAt: String(r.occurred_at), after,
        error: (r.error_detail as ActivityFeedItem['error']) ?? null,
      })
    }
  }

  // 3) weekly_report_activity (주간) — status 개념 없음(전부 success). 실패/부분 필터 시 제외.
  if (wantModule('weekly') && (!statusFilter || statusFilter === 'success')) {
    let q = db.from('weekly_report_activity')
      .select('id, action, week_start, occurred_at')
      .eq('user_id', user.id)
      .order('occurred_at', { ascending: false }).limit(FETCH)
    if (before) q = q.lt('occurred_at', before)
    const { data } = await q
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      items.push({
        id: `wra_${r.id}`, module: 'weekly', action: String(r.action), status: 'success',
        title: `${r.week_start} 주간보고`, occurredAt: String(r.occurred_at), after: null, error: null,
      })
    }
  }

  items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
  const hasMore = items.length > limit
  const pageItems = items.slice(0, limit)
  const nextBefore = hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1].occurredAt : null
  return NextResponse.json({ items: pageItems, hasMore, nextBefore })
}
