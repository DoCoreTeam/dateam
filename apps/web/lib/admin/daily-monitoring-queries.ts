/**
 * 관리자 일일업무 모니터링 — 데이터 페치 (server-only)
 *
 * createAdminClient() 결과(service-role, RLS 우회)를 인자로 받는다.
 * 순수 집계/포맷은 daily-monitoring.ts(SSOT)를 재사용한다.
 *
 * 감사 신뢰성 설계:
 * - 선택일 상세는 "하루치 전량(구조 필터 적용)"을 1회 페치한 뒤
 *   카운트·미작성자·블로커·정렬·페이지를 모두 동일 집합에서 도출한다 → 카운트=리스트 정합 보장.
 *   (하루 로그 수는 멤버×수건으로 bounded — 전량 페치가 안전·정확)
 * - 자유 텍스트 검색(q)은 리스트에만 적용(JS 부분일치). KPI/미작성자는 구조 필터 기준.
 * - 모든 페치는 error를 throw → "0건"이 진짜 0인지 실패인지 모호함 제거.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { EXCLUDE_RAW_HEAD_OR } from '@/lib/daily/raw-head'
import {
  type ActiveMember,
  type DayDetail,
  type EntryType,
  type MonitoringLogRow,
  type MonthAggregate,
  type RawLogRow,
  type SortKey,
  type SortDir,
  type TaskKind,
  DEFAULT_PAGE_SIZE,
  aggregateMonth,
  clampPage,
  computeMissingMembers,
  monthBounds,
  toMonitoringRow,
} from './daily-monitoring'

type Admin = SupabaseClient

/** 전량 페치 안전 상한 — 초과 시 콘솔 경고(침묵 절단 방지) */
const HARD_FETCH_CAP = 50000

function assertNoTruncation(label: string, len: number) {
  if (len >= HARD_FETCH_CAP) {
    console.warn(`[daily-monitoring] ${label}: fetch cap(${HARD_FETCH_CAP}) 도달 — 데이터가 절단됐을 수 있음`)
  }
}

/** 활성(작성 대상) 멤버 — api_user 제외, soft-delete 제외 */
export async function fetchActiveMembers(admin: Admin): Promise<ActiveMember[]> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, name, role')
    .is('deleted_at', null)
    .neq('role', 'api_user')
    .order('name')
  if (error) throw new Error(`fetchActiveMembers: ${error.message}`)
  return ((data as { id: string; name: string }[] | null) ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }))
}

/** 부서 id→name 맵 (org_nodes type=department) */
export async function fetchDepartments(admin: Admin): Promise<{ id: string; name: string }[]> {
  const { data, error } = await admin
    .from('org_nodes')
    .select('id, name')
    .eq('type', 'department')
    .order('display_order')
  if (error) throw new Error(`fetchDepartments: ${error.message}`)
  return (data as { id: string; name: string }[] | null) ?? []
}

/** 월 집계 — 셀 뱃지용. log_date 범위 + is_onboarding 제외. */
export async function fetchMonthAggregate(
  admin: Admin,
  month: string,
  totalActiveMembers: number,
): Promise<MonthAggregate> {
  const { start, end } = monthBounds(month)
  const { data, error } = await admin
    .from('daily_logs')
    .select('user_id, log_date, entry_type')
    .gte('log_date', start)
    .lte('log_date', end)
    .eq('is_onboarding', false)
    .or(EXCLUDE_RAW_HEAD_OR)   // 원문 raw 헤드(헤더 전용) 제외 — 월 집계 오염 방지
    .limit(HARD_FETCH_CAP)
  if (error) throw new Error(`fetchMonthAggregate: ${error.message}`)
  const rows = (data as { user_id: string; log_date: string; entry_type: EntryType }[] | null) ?? []
  assertNoTruncation('월 집계', rows.length)
  return aggregateMonth(rows, totalActiveMembers)
}

export interface DayLogFilters {
  q?: string
  departmentId?: string
  entryType?: EntryType | ''
  taskKind?: TaskKind | ''
  blockerOnly?: boolean
}

/** 구조 필터(q 제외)를 daily_logs 쿼리에 적용 — KPI·리스트 공통 기반 */
function applyStructuralFilters(qb: any, date: string, filters: DayLogFilters) {
  let q = qb.eq('log_date', date).eq('is_onboarding', false).or(EXCLUDE_RAW_HEAD_OR)
  if (filters.departmentId) q = q.eq('department_id', filters.departmentId)
  if (filters.taskKind) q = q.eq('task_kind', filters.taskKind)
  // blockerOnly가 켜지면 entry_type='blocker'로 강제(둘 동시 AND로 0행 되는 충돌 방지)
  if (filters.blockerOnly) q = q.eq('entry_type', 'blocker')
  else if (filters.entryType) q = q.eq('entry_type', filters.entryType)
  return q
}

/** q(자유 텍스트) JS 부분일치 — 인젝션 표면 0(서버 문자열 미구성) */
function matchesQuery(row: { content: string; originalInput: string | null }, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    row.content.toLowerCase().includes(needle) ||
    (row.originalInput ?? '').toLowerCase().includes(needle)
  )
}

// daily_logs는 user_id·assignee_user_id·owner_user_id 3개 FK로 profiles 참조 →
// 작성자(user_id) 관계를 FK 제약명으로 명시(임베드 모호성 방지).
const DETAIL_SELECT =
  'id, user_id, entry_type, task_kind, content, original_input, logged_at, created_at, updated_at, department_id, profiles!daily_logs_user_id_fkey(name)'

interface RawDetailRow extends RawLogRow {
  original_input: string | null
}

/** 정렬 키 → 비교값 추출 */
function sortValue(row: MonitoringLogRow, key: SortKey): string {
  switch (key) {
    case 'name':
      return row.authorName
    case 'department':
      return row.departmentName ?? ''
    case 'entry_type':
      return row.entryType
    case 'logged_at':
    default:
      return row.loggedAt
  }
}

/**
 * 선택일 상세 — 하루치 전량(구조 필터) 페치 후 JS에서 검색·정렬·페이지.
 * 전 데이터셋 기준 정렬이라 페이지 경계에서 순서가 일관(감사 신뢰).
 */
export async function fetchDayDetail(
  admin: Admin,
  date: string,
  filters: DayLogFilters,
  sort: SortKey,
  dir: SortDir,
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
  activeMembers: ActiveMember[] = [],
  deptNameById: Record<string, string> = {},
): Promise<DayDetail> {
  const { data, error } = await applyStructuralFilters(
    (admin.from('daily_logs') as any).select(DETAIL_SELECT),
    date,
    filters,
  )
    .order('logged_at', { ascending: true })
    .limit(HARD_FETCH_CAP)
  if (error) throw new Error(`fetchDayDetail: ${error.message}`)

  const raw = (data as RawDetailRow[] | null) ?? []
  assertNoTruncation(`선택일(${date})`, raw.length)

  // 구조 필터 기반 — KPI/미작성자/블로커 (q 미적용: 검색은 리스트 한정)
  const writerUserIds = new Set(raw.map((r) => r.user_id))
  const blockerCount = raw.filter((r) => r.entry_type === 'blocker').length
  const missingMembers = computeMissingMembers(writerUserIds, activeMembers)

  // 리스트 — q 부분일치 + 전체 정렬 + 페이지 슬라이스
  const q = (filters.q ?? '').trim().toLowerCase()
  const allRows: MonitoringLogRow[] = raw
    .map((r) => ({ row: toMonitoringRow(r, deptNameById), originalInput: r.original_input }))
    .filter(({ row, originalInput }) => matchesQuery({ content: row.content, originalInput }, q))
    .map(({ row }) => row)

  allRows.sort((a, b) => {
    const cmp = sortValue(a, sort).localeCompare(sortValue(b, sort), 'ko')
    return dir === 'asc' ? cmp : -cmp
  })

  const total = allRows.length
  const safePage = clampPage(page, total, pageSize)
  const rows = allRows.slice(safePage * pageSize, safePage * pageSize + pageSize)

  return {
    date,
    rows,
    writerCount: writerUserIds.size,
    blockerCount,
    totalActiveMembers: activeMembers.length,
    missingMembers,
    total,
    page: safePage,
    pageSize,
  }
}

/** CSV 내보내기용 — 기간 내 전체 로그(구조 필터 + q 반영). KST 시각·수정됨 포함. */
export async function fetchLogsForExport(
  admin: Admin,
  from: string,
  to: string,
  filters: DayLogFilters,
): Promise<RawDetailRow[]> {
  let qb = (admin.from('daily_logs') as any)
    .select(DETAIL_SELECT)
    .gte('log_date', from)
    .lte('log_date', to)
    .eq('is_onboarding', false)
    .or(EXCLUDE_RAW_HEAD_OR)   // 원문 raw 헤드(헤더 전용) 제외 — CSV 내보내기 오염 방지
    .order('log_date', { ascending: true })
    .order('logged_at', { ascending: true })
    .limit(HARD_FETCH_CAP)
  if (filters.departmentId) qb = qb.eq('department_id', filters.departmentId)
  if (filters.entryType) qb = qb.eq('entry_type', filters.entryType)
  if (filters.taskKind) qb = qb.eq('task_kind', filters.taskKind)
  if (filters.blockerOnly) qb = qb.eq('entry_type', 'blocker')
  const { data, error } = await qb
  if (error) throw new Error(`fetchLogsForExport: ${error.message}`)
  const raw = (data as RawDetailRow[] | null) ?? []
  assertNoTruncation('CSV export', raw.length)
  const q = (filters.q ?? '').trim().toLowerCase()
  if (!q) return raw
  return raw.filter((r) => matchesQuery({ content: r.content, originalInput: r.original_input }, q))
}
