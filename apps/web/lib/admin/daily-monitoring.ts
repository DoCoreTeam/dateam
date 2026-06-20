/**
 * 관리자 일일업무 모니터링 — 집계·조회·표시 포맷 SSOT
 *
 * 이 모듈은 캘린더형 모니터링 화면(`app/admin/daily-logs`)의 단일 진실원이다.
 * - 순수 함수(집계·차집합·포맷·달력 그리드)는 DB 없이 단위 테스트 가능
 * - 데이터 페치 함수는 createAdminClient() 결과를 인자로 받아 RLS 우회 조회
 *
 * 감사·평가 신뢰성 원칙:
 * - 작성 인원수 = distinct user_id (하루 여러 건 써도 1명)
 * - 요약 카운트와 리스트는 항상 동일 집합에서 도출 → 불일치 금지
 * - 작성(created_at)과 수정(updated_at) 구분 → 사후 변경 인지
 * - is_onboarding(실습행) 전 경로 제외
 * - api_user(외부 API 계정)는 "작성 대상 인원"에서 제외
 */

export const KST_TIME_ZONE = 'Asia/Seoul'

/** 수정 판정 임계값(ms). 트리거가 updated_at을 created_at보다 약간 뒤로 찍을 수 있어 여유. */
const EDITED_THRESHOLD_MS = 2000

/** 리스트 정렬 화이트리스트 — 임의 컬럼 정렬 차단(보안) */
export const SORT_KEYS = ['logged_at', 'name', 'department', 'entry_type'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'

export const DEFAULT_PAGE_SIZE = 50

export type EntryType = 'done' | 'doing' | 'planned' | 'blocker' | 'note'
export type TaskKind = 'personal' | 'dept_task'

/** 활성(작성 대상) 멤버 — api_user 제외, deleted_at null */
export interface ActiveMember {
  id: string
  name: string
}

/** 달력 셀 1칸 통계 */
export interface DayCellStat {
  date: string // YYYY-MM-DD
  writerCount: number // distinct 작성자 수
  logCount: number // 총 로그 수
  hasBlocker: boolean
}

/** 월 집계 결과 */
export interface MonthAggregate {
  /** date(YYYY-MM-DD) → 셀 통계 */
  byDate: Record<string, DayCellStat>
  totalActiveMembers: number
}

/** 리스트 1행(작성자 로그 + 표시용 파생값) */
export interface MonitoringLogRow {
  id: string
  userId: string
  authorName: string
  departmentName: string | null
  entryType: EntryType
  taskKind: TaskKind
  content: string
  loggedAt: string // ISO
  createdAt: string // ISO
  updatedAt: string // ISO
  isEdited: boolean
}

/** 선택일 상세 */
export interface DayDetail {
  date: string
  rows: MonitoringLogRow[]
  writerCount: number
  blockerCount: number
  totalActiveMembers: number
  missingMembers: { id: string; name: string }[]
  /** 페이지네이션 메타 */
  total: number
  page: number
  pageSize: number
}

/** daily_logs 조인 로우(raw) — 페치 함수 입력 형태 */
export interface RawLogRow {
  id: string
  user_id: string
  entry_type: EntryType
  task_kind: TaskKind
  content: string
  logged_at: string
  created_at: string
  updated_at: string
  department_id: string | null
  profiles?: { name: string | null } | null
}

// ─────────────────────────────────────────────────────────────
// 순수 함수 (DB 불필요 — 단위 테스트 대상)
// ─────────────────────────────────────────────────────────────

/** created_at 대비 updated_at이 임계값 이상 뒤면 "수정됨" */
export function isEditedLog(createdAt: string, updatedAt: string): boolean {
  const c = new Date(createdAt).getTime()
  const u = new Date(updatedAt).getTime()
  if (Number.isNaN(c) || Number.isNaN(u)) return false
  return u - c > EDITED_THRESHOLD_MS
}

/** KST 기준 오늘(YYYY-MM-DD) */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** ISO timestamp → KST 'HH:mm' */
export function formatKstTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/** ISO timestamp → KST 'MM-DD HH:mm' */
export function formatKstDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '----'
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** 'YYYY-MM' → 그 달의 시작/끝 date 문자열 */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate() // m은 1-기반, day 0 = 전달 말일 → 이번달 말일
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

/** 'YYYY-MM' 유효성 + 폴백(현재 KST 월) */
export function normalizeMonth(input: string | undefined, now: Date = new Date()): string {
  if (input && /^\d{4}-\d{2}$/.test(input)) {
    const [, m] = input.split('-').map(Number)
    if (m >= 1 && m <= 12) return input
  }
  return todayKst(now).slice(0, 7)
}

/** 페이지 번호를 [0, lastPage]로 클램프 (음수·초과 방지) */
export function clampPage(page: number, total: number, pageSize: number): number {
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  return Math.min(Math.max(0, page), lastPage)
}

/** 'YYYY-MM-DD' 유효성 검사 */
export function isValidDate(input: string | undefined): input is string {
  return !!input && /^\d{4}-\d{2}-\d{2}$/.test(input)
}

/** 정렬키 화이트리스트 폴백 */
export function normalizeSort(sort: string | undefined, dir: string | undefined): { sort: SortKey; dir: SortDir } {
  const sortKey = (SORT_KEYS as readonly string[]).includes(sort ?? '') ? (sort as SortKey) : 'logged_at'
  const sortDir: SortDir = dir === 'asc' ? 'asc' : 'desc'
  return { sort: sortKey, dir: sortDir }
}

/**
 * 월간 캘린더 그리드(주 단위 6줄). 월요일 시작.
 * 각 셀: { date, inMonth }
 */
export function buildCalendarGrid(month: string): { date: string; inMonth: boolean }[][] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  // 월요일 시작: getDay() 0(일)~6(토) → 월=0 오프셋
  const offset = (first.getDay() + 6) % 7
  const gridStart = new Date(y, m - 1, 1 - offset)
  const weeks: { date: string; inMonth: boolean }[][] = []
  const cur = new Date(gridStart)
  for (let w = 0; w < 6; w++) {
    const week: { date: string; inMonth: boolean }[] = []
    for (let d = 0; d < 7; d++) {
      const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      week.push({ date: ds, inMonth: cur.getMonth() === m - 1 })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/**
 * 월 집계 — date별 distinct 작성자 수 / 로그 수 / 블로커 유무.
 * @param rows daily_logs (is_onboarding 제외된 상태로 전달)
 */
export function aggregateMonth(
  rows: { user_id: string; log_date: string; entry_type: EntryType }[],
  totalActiveMembers: number,
): MonthAggregate {
  const byDate: Record<string, DayCellStat> = {}
  const writers: Record<string, Set<string>> = {}
  for (const r of rows) {
    if (!byDate[r.log_date]) {
      byDate[r.log_date] = { date: r.log_date, writerCount: 0, logCount: 0, hasBlocker: false }
      writers[r.log_date] = new Set()
    }
    byDate[r.log_date].logCount += 1
    writers[r.log_date].add(r.user_id)
    if (r.entry_type === 'blocker') byDate[r.log_date].hasBlocker = true
  }
  for (const date of Object.keys(byDate)) {
    byDate[date].writerCount = writers[date].size
  }
  return { byDate, totalActiveMembers }
}

/** 월 요약 통계 (상단 추이 스트립용) */
export interface MonthSummary {
  daysWithLogs: number // 로그가 있는 날 수
  totalWriterDays: number // Σ 일별 작성 인원 (인-일)
  avgWriters: number // 작성일 평균 작성 인원
  blockerDays: number // 블로커 발생일 수
}

export function summarizeMonth(byDate: Record<string, DayCellStat>): MonthSummary {
  const stats = Object.values(byDate)
  const daysWithLogs = stats.filter((s) => s.logCount > 0).length
  const totalWriterDays = stats.reduce((acc, s) => acc + s.writerCount, 0)
  const blockerDays = stats.filter((s) => s.hasBlocker).length
  const avgWriters = daysWithLogs > 0 ? Math.round((totalWriterDays / daysWithLogs) * 10) / 10 : 0
  return { daysWithLogs, totalWriterDays, avgWriters, blockerDays }
}

/** 미작성자 = 활성멤버 − 그날 작성자(distinct) */
export function computeMissingMembers(
  writerUserIds: Set<string>,
  activeMembers: ActiveMember[],
): { id: string; name: string }[] {
  return activeMembers
    .filter((m) => !writerUserIds.has(m.id))
    .map((m) => ({ id: m.id, name: m.name }))
}

/**
 * CSV 셀 이스케이프 (RFC4180) + 수식 인젝션 방어.
 * Excel/Sheets에서 =,+,-,@,탭,CR로 시작하는 셀은 수식으로 해석될 수 있어
 * 선행 작은따옴표로 무력화한다(OWASP CSV Injection 권고).
 */
export function csvCell(v: string): string {
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const ENTRY_LABEL: Record<EntryType, string> = {
  done: '완료',
  doing: '진행중',
  planned: '예정',
  blocker: '블로커',
  note: '메모',
}

const TASK_KIND_LABEL: Record<TaskKind, string> = {
  personal: '일일업무',
  dept_task: '부서업무',
}

/**
 * 모니터링 로그 → CSV 문자열. 감사·평가 근거 보존용.
 * 작성일시(KST)·"수정됨"·작성자·부서·타입 컬럼 포함. Excel 한글 대응 BOM 포함.
 */
export function buildMonitoringCsv(rows: MonitoringLogRow[]): string {
  const header = ['작성일시(KST)', '멤버', '부서', '구분', '타입', '수정됨', '내용']
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) {
    lines.push(
      [
        formatKstDateTime(r.loggedAt),
        r.authorName,
        r.departmentName ?? '',
        TASK_KIND_LABEL[r.taskKind] ?? r.taskKind,
        ENTRY_LABEL[r.entryType] ?? r.entryType,
        r.isEdited ? '수정됨' : '',
        r.content,
      ]
        .map((c) => csvCell(String(c)))
        .join(','),
    )
  }
  // ﻿ = UTF-8 BOM (Excel 한글 깨짐 방지)
  return '﻿' + lines.join('\r\n')
}

/** raw 로그 → 표시용 행 (수정됨 판정·부서명 매핑 포함) */
export function toMonitoringRow(raw: RawLogRow, deptNameById: Record<string, string>): MonitoringLogRow {
  return {
    id: raw.id,
    userId: raw.user_id,
    authorName: raw.profiles?.name ?? '(이름 없음)',
    departmentName: raw.department_id ? (deptNameById[raw.department_id] ?? null) : null,
    entryType: raw.entry_type,
    taskKind: raw.task_kind,
    content: raw.content,
    loggedAt: raw.logged_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    isEdited: isEditedLog(raw.created_at, raw.updated_at),
  }
}
