import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  auditTableToModule, RESTORABLE_TABLES,
  type ActivityFeedItem, type ActivityStatus, type FeedModule,
} from '@/lib/work/activity-log'

// GET /api/work/activity — 업무 허브 통합 이력 피드.
// 소스: audit_log(트리거 기반 완전 감사 = 성공 SSOT, 되살리기 대상) + activity_log(앱단 실패/에러만).
//   → audit_log가 모든 성공 변경을 자동 기록하므로 앱단 성공 로그와 중복 없이 실패만 병합.
// occurred_at 커서(before) 기반. RLS가 소유 스코프 강제. 필터: module[], status.

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const OP_ACTION: Record<string, string> = { insert: 'create', update: 'update', delete: 'delete', restore: 'restore' }

function titleFrom(after: Record<string, unknown> | null, before: Record<string, unknown> | null): string | null {
  const src = after ?? before
  if (!src) return null
  if (typeof src.name === 'string') return src.name
  if (typeof src.content === 'string') return src.content
  if (typeof src.performance === 'string') return src.performance.replace(/<[^>]+>/g, '').slice(0, 80)
  return null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT))
  const before = sp.get('before')
  const modulesRaw = sp.getAll('module').filter(Boolean)
  const wantModule = (m: FeedModule) => modulesRaw.length === 0 || modulesRaw.includes(m)
  const statusRaw = sp.get('status')
  const statusFilter: ActivityStatus | null =
    statusRaw === 'success' || statusRaw === 'failure' || statusRaw === 'partial' ? statusRaw : null

  const FETCH = limit + 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const items: ActivityFeedItem[] = []

  // 1) audit_log — 성공(커밋된 모든 변경). status 필터가 failure/partial이면 제외.
  if (!statusFilter || statusFilter === 'success') {
    let q = db.from('audit_log')
      .select('id, table_name, entity_id, op, before_json, after_json, occurred_at')
      .order('occurred_at', { ascending: false }).limit(FETCH)
    if (before) q = q.lt('occurred_at', before)
    const { data } = await q
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const after = (r.after_json as Record<string, unknown>) ?? null
      const beforeJ = (r.before_json as Record<string, unknown>) ?? null
      const mod = auditTableToModule(String(r.table_name), after ?? beforeJ)
      if (!mod || !wantModule(mod)) continue
      const op = String(r.op)
      const restorable = !!beforeJ && RESTORABLE_TABLES.has(String(r.table_name)) && (op === 'update' || op === 'delete')
      items.push({
        id: `au_${r.id}`, module: mod, action: OP_ACTION[op] ?? op, status: 'success',
        title: titleFrom(after, beforeJ), occurredAt: String(r.occurred_at),
        before: beforeJ, after, error: null, auditId: Number(r.id), restorable,
      })
    }
  }

  // 2) activity_log — 실패/부분만(앱단이 잡은 것; 트리거는 커밋된 것만 봄). status=success 필터면 제외.
  if (!statusFilter || statusFilter === 'failure' || statusFilter === 'partial') {
    let q = db.from('activity_log')
      .select('id, module, action, status, title, error_detail, occurred_at')
      .neq('status', 'success')
      .order('occurred_at', { ascending: false }).limit(FETCH)
    if (before) q = q.lt('occurred_at', before)
    if (statusFilter) q = q.eq('status', statusFilter)
    const { data } = await q
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const mod = r.module as FeedModule
      if (!wantModule(mod)) continue
      items.push({
        id: `al_${r.id}`, module: mod, action: String(r.action), status: r.status as ActivityStatus,
        title: (r.title as string) ?? null, occurredAt: String(r.occurred_at),
        before: null, after: null, error: (r.error_detail as ActivityFeedItem['error']) ?? null,
        auditId: null, restorable: false,
      })
    }
  }

  items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
  const hasMore = items.length > limit
  const pageItems = items.slice(0, limit)
  const nextBefore = hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1].occurredAt : null
  return NextResponse.json({ items: pageItems, hasMore, nextBefore })
}
