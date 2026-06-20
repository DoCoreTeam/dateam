import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import {
  buildMonitoringCsv,
  isValidDate,
  toMonitoringRow,
  type EntryType,
  type TaskKind,
} from '@/lib/admin/daily-monitoring'
import {
  fetchDepartments,
  fetchLogsForExport,
  type DayLogFilters,
} from '@/lib/admin/daily-monitoring-queries'

/**
 * 관리자 일일업무 모니터링 — CSV 내보내기 (감사·평가 근거 보존).
 * GET /admin/daily-logs/export?from=YYYY-MM-DD&to=YYYY-MM-DD&dept=&type=&kind=&blocker=
 * 권한: admin 전용. 다운로드 행위는 서버 로그로 남는다.
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireAdminApi()
  if (error) return error

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (!isValidDate(from) || !isValidDate(to)) {
    return NextResponse.json({ error: 'from/to 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)' }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ error: 'from은 to보다 클 수 없습니다' }, { status: 400 })
  }
  // 기간 상한(366일) — 거대 export로 인한 부하 방지
  const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000
  if (new Date(to).getTime() - new Date(from).getTime() > MAX_RANGE_MS) {
    return NextResponse.json({ error: '내보내기 기간은 최대 366일입니다' }, { status: 400 })
  }

  const ENTRY_TYPES: EntryType[] = ['done', 'doing', 'planned', 'blocker', 'note']
  const TASK_KINDS: TaskKind[] = ['personal', 'dept_task']
  const typeParam = sp.get('type') as EntryType | null
  const kindParam = sp.get('kind') as TaskKind | null

  const filters: DayLogFilters = {
    q: (sp.get('q') ?? '').trim() || undefined,
    departmentId: sp.get('dept') ?? undefined,
    entryType: typeParam && ENTRY_TYPES.includes(typeParam) ? typeParam : '',
    taskKind: kindParam && TASK_KINDS.includes(kindParam) ? kindParam : '',
    blockerOnly: sp.get('blocker') === '1',
  }

  try {
    const admin = createAdminClient()
    const depts = await fetchDepartments(admin)
    const deptNameById = Object.fromEntries(depts.map((d) => [d.id, d.name]))
    const raw = await fetchLogsForExport(admin, from, to, filters)
    const rows = raw.map((r) => toMonitoringRow(r, deptNameById))
    const csv = buildMonitoringCsv(rows)

    // 감사: 누가 언제 무슨 범위를 내보냈는지 서버 로그
    console.info(`[daily-monitoring-export] admin=${user.id} range=${from}~${to} rows=${rows.length}`)

    const filename = `daily-monitoring_${from}_${to}.csv`
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '알 수 없는 오류'
    console.error('[daily-monitoring-export] failed', msg)
    return NextResponse.json({ error: '내보내기 실패' }, { status: 500 })
  }
}
