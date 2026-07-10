import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  auditTableToModule, RESTORABLE_TABLES,
  type ActivityFeedItem, type ActivityStatus, type FeedModule,
} from '@/lib/work/activity-log'
import { isRawHead } from '@/lib/daily/raw-head'
import { resolveWeeklyBeforeAfter, type WeeklySnapshot, type WeeklyActivity, type BeforeAfter } from '@/lib/work/weekly-history'
import type { WeeklyRow } from '@/lib/work/activity-diff'

// GET /api/work/activity — 업무 허브 통합 이력 피드(4개 원천 통합, 읽기 전용).
//   ① audit_log(daily_logs 트리거) — 일일·부서, before/after. 원문 raw헤드 제외(중복 방지).
//   ② project_activity — 프로젝트, before/after 스냅샷.
//   ③ weekly_report_activity + weekly_report_snapshots + 라이브 — 주간, before/after 행 페어링(마이그144).
//   ④ activity_log — 앱단이 잡은 실패/부분(커밋 안 된 것).
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
  const wantSuccess = !statusFilter || statusFilter === 'success'
  const wantFailure = !statusFilter || statusFilter === 'failure' || statusFilter === 'partial'

  const FETCH = limit + 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const items: ActivityFeedItem[] = []

  // ① audit_log — 일일·부서(성공). raw헤드(원문 즉시저장 헤더)는 AI분해 자식과 이중노출되므로 제외.
  if (wantSuccess && (wantModule('daily') || wantModule('dept_task'))) {
    let q = db.from('audit_log')
      .select('id, table_name, entity_id, op, before_json, after_json, occurred_at')
      .in('table_name', ['daily_logs'])
      .order('occurred_at', { ascending: false }).limit(FETCH)
    if (before) q = q.lt('occurred_at', before)
    const { data } = await q
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const after = (r.after_json as Record<string, unknown>) ?? null
      const beforeJ = (r.before_json as Record<string, unknown>) ?? null
      const snap = after ?? beforeJ
      // 원문 raw헤드 insert/변경은 피드에서 숨김(집계 SSOT isRawHead 재사용).
      if (snap && isRawHead(snap as never)) continue
      const mod = auditTableToModule(String(r.table_name), snap)
      if (!mod || !wantModule(mod)) continue
      const op = String(r.op)
      const restorable = !!beforeJ && RESTORABLE_TABLES.has(String(r.table_name)) && (op === 'update' || op === 'delete')
      items.push({
        id: `au_${r.id}`, module: mod, action: OP_ACTION[op] ?? op, status: 'success',
        title: titleFrom(after, beforeJ), occurredAt: String(r.occurred_at),
        before: beforeJ, after, error: null,
        restore: restorable ? { kind: 'audit', ref: Number(r.id) } : null,
      })
    }
  }

  // ② project_activity — 프로젝트. before/after 스냅샷 보유. status 존중.
  if (wantModule('project')) {
    let q = db.from('project_activity')
      .select('id, action, status, before_snapshot, after_snapshot, error_detail, occurred_at')
      .order('occurred_at', { ascending: false }).limit(FETCH)
    if (before) q = q.lt('occurred_at', before)
    if (statusFilter === 'success') q = q.eq('status', 'success')
    else if (statusFilter) q = q.neq('status', 'success')
    const { data } = await q
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const st = (r.status === 'failure' || r.status === 'partial') ? (r.status as ActivityStatus) : 'success'
      const after = (r.after_snapshot as Record<string, unknown>) ?? null
      const beforeJ = (r.before_snapshot as Record<string, unknown>) ?? null
      const act = String(r.action)
      // 성공 + before 있음 + 수정/삭제면 되살리기 가능(생성은 되돌릴 before 없음).
      const canRestore = st === 'success' && !!beforeJ && (act === 'update' || act === 'delete')
      items.push({
        id: `pa_${r.id}`, module: 'project', action: act, status: st,
        title: titleFrom(after, beforeJ), occurredAt: String(r.occurred_at),
        before: beforeJ, after,
        error: (r.error_detail as ActivityFeedItem['error']) ?? null,
        restore: canRestore ? { kind: 'project', ref: String(r.id) } : null,
      })
    }
  }

  // ③ 주간보고 — 이벤트(weekly_report_activity) + 스냅샷/라이브 페어링으로 before/after 행.
  // ⚠️ 소유자 스코프는 RLS만으로 강제되지 않는다: weekly_reports(라이브, 마이그002)는 로그인 전원
  // 공개, weekly_report_activity(마이그120)는 계층열람 허용 → 세 쿼리 모두 user_id 필터를 명시한다
  // (없으면 타 사용자 같은 주차 행이 liveByWeek에 섞여 diff 오염·열람권한 초과).
  if (wantSuccess && wantModule('weekly')) {
    let q = db.from('weekly_report_activity')
      .select('id, user_id, week_start, action, occurred_at')
      .eq('user_id', user.id)
      .order('occurred_at', { ascending: false }).limit(FETCH)
    if (before) q = q.lt('occurred_at', before)
    const { data } = await q
    const acts = (data ?? []) as Record<string, unknown>[]
    if (acts.length > 0) {
      const weeks = Array.from(new Set(acts.map((a) => String(a.week_start))))
      // 그 주차들의 스냅샷 + 라이브 확정본(RLS로 본인 것만).
      const { data: snapRows } = await db.from('weekly_report_snapshots')
        .select('id, week_start, rows_json, taken_at').eq('user_id', user.id).in('week_start', weeks)
      const { data: liveRows } = await db.from('weekly_reports')
        .select('week_start, category, seq, performance, plan, issues')
        .eq('user_id', user.id).in('week_start', weeks).is('deleted_at', null)

      const snapByWeek = new Map<string, WeeklySnapshot[]>()
      for (const s of (snapRows ?? []) as Record<string, unknown>[]) {
        const wk = String(s.week_start)
        const arr = snapByWeek.get(wk) ?? []
        arr.push({ id: String(s.id), takenAt: String(s.taken_at), rows: (s.rows_json as WeeklyRow[]) ?? [] })
        snapByWeek.set(wk, arr)
      }
      const liveByWeek = new Map<string, WeeklyRow[]>()
      for (const r of (liveRows ?? []) as Record<string, unknown>[]) {
        const wk = String(r.week_start ?? '')
        const arr = liveByWeek.get(wk) ?? []
        arr.push({
          category: r.category as string, seq: r.seq as number,
          performance: r.performance as string, plan: r.plan as string, issues: r.issues as string,
        })
        liveByWeek.set(wk, arr)
      }
      // 주차별 페어링 결과.
      const baOf = new Map<string, BeforeAfter>()
      for (const wk of weeks) {
        const weekActs: WeeklyActivity[] = acts.filter((a) => String(a.week_start) === wk)
          .map((a) => ({ id: String(a.id), occurredAt: String(a.occurred_at) }))
        const resolved = resolveWeeklyBeforeAfter(weekActs, snapByWeek.get(wk) ?? [], liveByWeek.get(wk) ?? [])
        resolved.forEach((v, k) => baOf.set(k, v))
      }

      // 주간 되살리기는 그 주차 전체를 스냅샷 시점으로 replace(파괴적)한다. 오래된 활동에 되살리면
      // 이후 최신 편집이 무경고로 사라지므로, 되돌리기는 주차별 '가장 최근 활동'에만 노출한다
      // (= 최근 변경 취소). 더 과거 시점 복원은 주간보고 화면 WeeklyEditHistory에서 별도 제공.
      const latestActIdByWeek = new Map<string, string>()   // acts는 occurred_at desc → 주차별 첫 등장이 최신
      for (const a of acts) {
        const wk = String(a.week_start)
        if (!latestActIdByWeek.has(wk)) latestActIdByWeek.set(wk, String(a.id))
      }

      for (const a of acts) {
        const ba = baOf.get(String(a.id))
        const action = String(a.action)
        // 마이그144 이전 'edit'은 대응 before 스냅샷이 없어 before=[](소급 불가) →
        // "없음 → 전체내용" 오표시 방지: 실제 before가 있을 때(또는 생성/삭제)만 diff 노출.
        // create=after(신규내용)로 판단, edit/delete=before가 있어야 diff 가능.
        const canDiff = !!ba && (action === 'create' ? ba.after.length > 0 : ba.before.length > 0)
        // ⚠️ latestActIdByWeek는 이 페이지 내에서만 최신을 판정한다. 커서(before)가 있는 2페이지+에서는
        // 페이지-로컬 최신이 전역 최신이 아닐 수 있어(다른 모듈 활동에 밀려 분산), 되살리기를 노출하면
        // 오래된 활동으로 최신 편집을 무경고 덮어쓸 위험이 있다. 따라서 되살리기는 커서 없는 1페이지
        // (=desc 정렬상 주차 최신이 반드시 여기 있음)에서만 노출한다. 더 깊은 복원은 WeeklyEditHistory.
        const isLatestForWeek = !before && latestActIdByWeek.get(String(a.week_start)) === String(a.id)
        // 되살리기: before 스냅샷 있음 + (1페이지의) 최신 활동 + edit/delete = 그 직전 시점으로 복원.
        const canRestore = !!ba?.beforeSnapshotId && isLatestForWeek && (action === 'edit' || action === 'delete')
        items.push({
          id: `wa_${a.id}`, module: 'weekly', action, status: 'success',
          title: `${a.week_start} 주간보고`, occurredAt: String(a.occurred_at),
          before: canDiff ? { rows: ba!.before } : null,
          after: canDiff ? { rows: ba!.after } : null,
          error: null,
          restore: canRestore ? { kind: 'weekly', ref: ba!.beforeSnapshotId! } : null,
        })
      }
    }
  }

  // ④ activity_log — 실패/부분만(앱단이 잡은 것; 트리거는 커밋된 것만 봄).
  if (wantFailure) {
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
        restore: null,
      })
    }
  }

  // occurred_at desc, 동률은 id desc로 안정 정렬(슬라이스 비결정성 제거).
  // ⚠️ 알려진 제약: 커서는 단일 occurred_at 기반이라 경계에 동일 마이크로초 행이 여럿이면
  //    일부가 다음 페이지에서 누락될 수 있음(4원천 id타입 상이 → 복합커서는 후속 과제).
  items.sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  const hasMore = items.length > limit
  const pageItems = items.slice(0, limit)
  const nextBefore = hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1].occurredAt : null
  return NextResponse.json({ items: pageItems, hasMore, nextBefore })
}
