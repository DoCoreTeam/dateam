import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import {
  type EntryType,
  type TaskKind,
  isValidDate,
  normalizeMonth,
  normalizeSort,
  todayKst,
  summarizeMonth,
  DEFAULT_PAGE_SIZE,
} from '@/lib/admin/daily-monitoring'
import {
  fetchActiveMembers,
  fetchDepartments,
  fetchMonthAggregate,
  fetchDayDetail,
  type DayLogFilters,
} from '@/lib/admin/daily-monitoring-queries'
import MonitoringCalendar from './MonitoringCalendar'
import DayDetailPanel from './DayDetailPanel'

const ENTRY_TYPE_VALUES: EntryType[] = ['done', 'doing', 'planned', 'blocker', 'note']
const TASK_KIND_VALUES: TaskKind[] = ['personal', 'dept_task']

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

export default async function AdminDailyLogsPage({ searchParams }: PageProps) {
  // 권한 게이트 — 공용 SSOT(redirect 처리). 이후 service-role 클라이언트로 조회.
  await requireAdmin()
  const admin = createAdminClient()

  // searchParams 정규화(화이트리스트)
  const params = await searchParams
  const date = isValidDate(params.date) ? params.date : todayKst()
  const month = normalizeMonth(params.month ?? date.slice(0, 7))
  const { sort, dir } = normalizeSort(params.sort, params.dir)
  const page = parsePage(params.page)

  const entryType: EntryType | '' = ENTRY_TYPE_VALUES.includes(params.type as EntryType)
    ? (params.type as EntryType)
    : ''
  const taskKind: TaskKind | '' = TASK_KIND_VALUES.includes(params.kind as TaskKind)
    ? (params.kind as TaskKind)
    : ''
  const q = (params.q ?? '').trim()
  const departmentId = (params.dept ?? '').trim()
  const blockerOnly = params.blocker === '1'

  const filters: DayLogFilters = { q, departmentId, entryType, taskKind, blockerOnly }

  // 데이터 페치 — 활성멤버 → 부서 → 월집계 → 선택일 상세
  const [activeMembers, departments] = await Promise.all([
    fetchActiveMembers(admin),
    fetchDepartments(admin),
  ])
  const deptNameById: Record<string, string> = Object.fromEntries(
    departments.map((d) => [d.id, d.name]),
  )

  const [monthAggregate, dayDetail] = await Promise.all([
    fetchMonthAggregate(admin, month, activeMembers.length),
    fetchDayDetail(admin, date, filters, sort, dir, page, DEFAULT_PAGE_SIZE, activeMembers, deptNameById),
  ])

  // 필터 외 파라미터 보존용 현재 검색 상태(캘린더·패널 URL 빌드)
  const baseParams: Record<string, string> = {}
  if (q) baseParams.q = q
  if (departmentId) baseParams.dept = departmentId
  if (entryType) baseParams.type = entryType
  if (taskKind) baseParams.kind = taskKind
  if (blockerOnly) baseParams.blocker = '1'
  if (sort !== 'logged_at') baseParams.sort = sort
  if (dir !== 'desc') baseParams.dir = dir

  return (
    <div className="page-inner">
      <header className="monitor-header">
        <div>
          <h1 className="monitor-title">일일업무 모니터링</h1>
          <p className="monitor-subtitle">달력에서 작성 현황을 보고, 날짜를 눌러 상세를 확인합니다.</p>
        </div>
      </header>

      <MonitoringCalendar
        month={month}
        byDate={monthAggregate.byDate}
        totalActiveMembers={monthAggregate.totalActiveMembers}
        summary={summarizeMonth(monthAggregate.byDate)}
        selectedDate={date}
        baseParams={baseParams}
      />

      <DayDetailPanel
        detail={dayDetail}
        departments={departments}
        month={month}
        sort={sort}
        dir={dir}
        filters={filters}
      />
    </div>
  )
}
