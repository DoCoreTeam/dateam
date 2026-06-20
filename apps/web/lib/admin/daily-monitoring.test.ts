import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isEditedLog,
  todayKst,
  formatKstTime,
  formatKstDateTime,
  monthBounds,
  normalizeMonth,
  isValidDate,
  normalizeSort,
  buildCalendarGrid,
  aggregateMonth,
  computeMissingMembers,
  toMonitoringRow,
  buildMonitoringCsv,
  summarizeMonth,
  clampPage,
  csvCell,
  type ActiveMember,
  type EntryType,
  type MonitoringLogRow,
  type RawLogRow,
} from './daily-monitoring.ts'

function row(partial: Partial<MonitoringLogRow>): MonitoringLogRow {
  return {
    id: 'l',
    userId: 'u',
    authorName: '김철수',
    departmentName: '영업1팀',
    entryType: 'done',
    taskKind: 'personal',
    content: '내용',
    loggedAt: '2026-06-16T05:00:00.000Z',
    createdAt: '2026-06-16T05:00:00.000Z',
    updatedAt: '2026-06-16T05:00:00.000Z',
    isEdited: false,
    ...partial,
  }
}

// ── isEditedLog: 작성 vs 수정 구분 (감사 핵심) ──────────────
test('isEditedLog: created==updated → 수정 아님', () => {
  const t = '2026-06-16T05:00:00.000Z'
  assert.equal(isEditedLog(t, t), false)
})

test('isEditedLog: updated가 임계값(2s) 이내면 수정 아님 (트리거 여유)', () => {
  assert.equal(isEditedLog('2026-06-16T05:00:00.000Z', '2026-06-16T05:00:01.500Z'), false)
})

test('isEditedLog: updated가 임계값 초과면 수정됨', () => {
  assert.equal(isEditedLog('2026-06-16T05:00:00.000Z', '2026-06-16T05:10:00.000Z'), true)
})

test('isEditedLog: 잘못된 시각 → false (예외 안전)', () => {
  assert.equal(isEditedLog('bad', 'worse'), false)
})

// ── KST 포맷 (시간대 일관성) ────────────────────────────────
test('formatKstTime: UTC 05:00 → KST 14:00', () => {
  assert.equal(formatKstTime('2026-06-16T05:00:00.000Z'), '14:00')
})

test('formatKstDateTime: UTC → KST MM-DD HH:mm', () => {
  // UTC 2026-06-16T20:30Z = KST 2026-06-17 05:30
  assert.equal(formatKstDateTime('2026-06-16T20:30:00.000Z'), '06-17 05:30')
})

test('formatKstTime: 잘못된 ISO → --:--', () => {
  assert.equal(formatKstTime('nope'), '--:--')
})

test('todayKst: YYYY-MM-DD 형식', () => {
  assert.match(todayKst(new Date('2026-06-16T20:00:00Z')), /^\d{4}-\d{2}-\d{2}$/)
  // UTC 20:00 16일 = KST 17일 05:00
  assert.equal(todayKst(new Date('2026-06-16T20:00:00Z')), '2026-06-17')
})

// ── month/date 검증·폴백 (보안: 임의 입력 차단) ─────────────
test('monthBounds: 2026-02 윤년 아님 → 28일', () => {
  assert.deepEqual(monthBounds('2026-02'), { start: '2026-02-01', end: '2026-02-28' })
})

test('monthBounds: 2026-06 → 30일', () => {
  assert.deepEqual(monthBounds('2026-06'), { start: '2026-06-01', end: '2026-06-30' })
})

test('monthBounds: 2024-02 윤년 → 29일', () => {
  assert.deepEqual(monthBounds('2024-02'), { start: '2024-02-01', end: '2024-02-29' })
})

test('normalizeSort: dir=desc 명시 → desc', () => {
  assert.deepEqual(normalizeSort('name', 'desc'), { sort: 'name', dir: 'desc' })
  assert.deepEqual(normalizeSort('department', 'asc'), { sort: 'department', dir: 'asc' })
})

test('clampPage: 음수·초과·정상 클램프', () => {
  assert.equal(clampPage(-3, 100, 50), 0) // 음수
  assert.equal(clampPage(99, 100, 50), 1) // 초과 → lastPage(1)
  assert.equal(clampPage(1, 100, 50), 1) // 정상
  assert.equal(clampPage(5, 0, 50), 0) // total 0 → 0
})

test('csvCell: 탭·CR 시작도 수식 방어', () => {
  assert.match(csvCell('\t탭'), /^"?'\t/)
  assert.match(csvCell('\r캐리지'), /'\r/)
})

test('normalizeMonth: 유효 → 그대로', () => {
  assert.equal(normalizeMonth('2026-06'), '2026-06')
})

test('normalizeMonth: 잘못된 월(13) → KST 현재월 폴백', () => {
  assert.equal(normalizeMonth('2026-13', new Date('2026-06-16T05:00:00Z')), '2026-06')
})

test('normalizeMonth: 쓰레기 입력 → 폴백', () => {
  assert.equal(normalizeMonth('drop table', new Date('2026-06-16T05:00:00Z')), '2026-06')
})

test('isValidDate: 형식 검사', () => {
  assert.equal(isValidDate('2026-06-16'), true)
  assert.equal(isValidDate('2026/06/16'), false)
  assert.equal(isValidDate(undefined), false)
})

test('normalizeSort: 화이트리스트 외 → logged_at 폴백', () => {
  assert.deepEqual(normalizeSort('content', 'asc'), { sort: 'logged_at', dir: 'asc' })
  assert.deepEqual(normalizeSort('name', 'desc'), { sort: 'name', dir: 'desc' })
  assert.deepEqual(normalizeSort(undefined, undefined), { sort: 'logged_at', dir: 'desc' })
})

// ── 캘린더 그리드 ──────────────────────────────────────────
test('buildCalendarGrid: 6주 × 7일, 월요일 시작', () => {
  const grid = buildCalendarGrid('2026-06')
  assert.equal(grid.length, 6)
  assert.equal(grid[0].length, 7)
  // 2026-06-01은 월요일 → 첫 셀이 06-01
  assert.equal(grid[0][0].date, '2026-06-01')
  assert.equal(grid[0][0].inMonth, true)
})

test('buildCalendarGrid: 이전달 셀은 inMonth=false', () => {
  // 2026-07-01은 수요일 → 그리드 첫 두 칸은 6월
  const grid = buildCalendarGrid('2026-07')
  assert.equal(grid[0][0].inMonth, false)
  assert.equal(grid[0][2].date, '2026-07-01')
  assert.equal(grid[0][2].inMonth, true)
})

// ── 월 집계: distinct 작성자 (감사 핵심) ────────────────────
test('aggregateMonth: 같은 user 하루 여러 건 → 1명으로 카운트', () => {
  const rows = [
    { user_id: 'u1', log_date: '2026-06-16', entry_type: 'done' as EntryType },
    { user_id: 'u1', log_date: '2026-06-16', entry_type: 'doing' as EntryType },
    { user_id: 'u2', log_date: '2026-06-16', entry_type: 'blocker' as EntryType },
  ]
  const agg = aggregateMonth(rows, 10)
  assert.equal(agg.byDate['2026-06-16'].writerCount, 2)
  assert.equal(agg.byDate['2026-06-16'].logCount, 3)
  assert.equal(agg.byDate['2026-06-16'].hasBlocker, true)
  assert.equal(agg.totalActiveMembers, 10)
})

test('aggregateMonth: 블로커 없으면 hasBlocker=false', () => {
  const rows = [{ user_id: 'u1', log_date: '2026-06-17', entry_type: 'done' as EntryType }]
  const agg = aggregateMonth(rows, 5)
  assert.equal(agg.byDate['2026-06-17'].hasBlocker, false)
})

test('aggregateMonth: 빈 입력 → 빈 byDate', () => {
  const agg = aggregateMonth([], 5)
  assert.deepEqual(agg.byDate, {})
})

// ── 미작성자 차집합 (감사 핵심) ─────────────────────────────
test('computeMissingMembers: 활성멤버 − 작성자', () => {
  const members: ActiveMember[] = [
    { id: 'u1', name: '김철수' },
    { id: 'u2', name: '이영희' },
    { id: 'u3', name: '박민수' },
  ]
  const writers = new Set(['u1'])
  const missing = computeMissingMembers(writers, members)
  assert.deepEqual(missing, [
    { id: 'u2', name: '이영희' },
    { id: 'u3', name: '박민수' },
  ])
})

test('computeMissingMembers: 전원 작성 → 빈 배열', () => {
  const members: ActiveMember[] = [{ id: 'u1', name: 'A' }]
  assert.deepEqual(computeMissingMembers(new Set(['u1']), members), [])
})

// ── toMonitoringRow: 부서명 매핑·수정됨 판정 ────────────────
test('toMonitoringRow: 부서명 매핑 + isEdited', () => {
  const raw: RawLogRow = {
    id: 'l1',
    user_id: 'u1',
    entry_type: 'done',
    task_kind: 'personal',
    content: '거래처 미팅',
    logged_at: '2026-06-16T05:00:00.000Z',
    created_at: '2026-06-16T05:00:00.000Z',
    updated_at: '2026-06-16T06:00:00.000Z',
    department_id: 'd1',
    profiles: { name: '김철수' },
  }
  const row = toMonitoringRow(raw, { d1: '영업1팀' })
  assert.equal(row.authorName, '김철수')
  assert.equal(row.departmentName, '영업1팀')
  assert.equal(row.isEdited, true)
})

test('toMonitoringRow: 이름/부서 없을 때 폴백', () => {
  const raw: RawLogRow = {
    id: 'l2',
    user_id: 'u2',
    entry_type: 'note',
    task_kind: 'personal',
    content: 'x',
    logged_at: '2026-06-16T05:00:00.000Z',
    created_at: '2026-06-16T05:00:00.000Z',
    updated_at: '2026-06-16T05:00:00.000Z',
    department_id: null,
    profiles: null,
  }
  const row = toMonitoringRow(raw, {})
  assert.equal(row.authorName, '(이름 없음)')
  assert.equal(row.departmentName, null)
  assert.equal(row.isEdited, false)
})

// ── 카운트=리스트 정합 시뮬레이션 ──────────────────────────
// ── 월 요약 통계 ───────────────────────────────────────────
test('summarizeMonth: 작성일수·인-일·평균·블로커일', () => {
  const agg = aggregateMonth(
    [
      { user_id: 'u1', log_date: '2026-06-16', entry_type: 'done' as EntryType },
      { user_id: 'u2', log_date: '2026-06-16', entry_type: 'blocker' as EntryType },
      { user_id: 'u1', log_date: '2026-06-17', entry_type: 'done' as EntryType },
    ],
    10,
  )
  const s = summarizeMonth(agg.byDate)
  assert.equal(s.daysWithLogs, 2)
  assert.equal(s.totalWriterDays, 3) // 16일 2명 + 17일 1명
  assert.equal(s.avgWriters, 1.5)
  assert.equal(s.blockerDays, 1)
})

test('summarizeMonth: 빈 달 → 0', () => {
  assert.deepEqual(summarizeMonth({}), {
    daysWithLogs: 0,
    totalWriterDays: 0,
    avgWriters: 0,
    blockerDays: 0,
  })
})

// ── CSV 내보내기 (감사 근거 보존) ─────────────────────────
test('buildMonitoringCsv: 헤더 + BOM + 행', () => {
  const csv = buildMonitoringCsv([row({ content: '거래처 미팅', isEdited: true })])
  assert.ok(csv.startsWith('﻿'), 'UTF-8 BOM 시작')
  const lines = csv.replace('﻿', '').split('\r\n')
  assert.equal(lines[0], '작성일시(KST),멤버,부서,구분,타입,수정됨,내용')
  assert.match(lines[1], /김철수/)
  assert.match(lines[1], /수정됨/)
  assert.match(lines[1], /완료/)
})

test('buildMonitoringCsv: 콤마·따옴표·줄바꿈 이스케이프', () => {
  const csv = buildMonitoringCsv([row({ content: 'a,b "c"\n d' })])
  const dataLine = csv.replace('﻿', '').split('\r\n')[1]
  assert.match(dataLine, /"a,b ""c""/)
})

test('buildMonitoringCsv: 수정 안 된 행은 수정됨 칸 비움', () => {
  const csv = buildMonitoringCsv([row({ isEdited: false, departmentName: null })])
  const cells = csv.replace('﻿', '').split('\r\n')[1].split(',')
  // 작성일시,멤버,부서(빈),구분,타입,수정됨(빈),내용
  assert.equal(cells[2], '') // 부서 없음
  assert.equal(cells[5], '') // 수정 안됨
})

test('buildMonitoringCsv: 수식 인젝션 방어 — =SUM 셀에 선행 따옴표', () => {
  const csv = buildMonitoringCsv([row({ content: '=SUM(A1:A9)' })])
  const dataLine = csv.replace('﻿', '').split('\r\n')[1]
  assert.match(dataLine, /'=SUM\(A1:A9\)/) // =로 시작 → 작은따옴표 선행
})

test('buildMonitoringCsv: 수식+콤마 동시 → 따옴표 래핑까지', () => {
  const csv = buildMonitoringCsv([row({ content: '=1,2' })])
  const dataLine = csv.replace('﻿', '').split('\r\n')[1]
  assert.match(dataLine, /"'=1,2"/)
})

test('buildMonitoringCsv: +,-,@ 시작도 방어', () => {
  assert.match(buildMonitoringCsv([row({ content: '+1' })]).split('\r\n')[1], /'\+1/)
  assert.match(buildMonitoringCsv([row({ content: '@cmd' })]).split('\r\n')[1], /'@cmd/)
})

test('buildMonitoringCsv: 빈 입력 → 헤더만', () => {
  const csv = buildMonitoringCsv([])
  assert.equal(csv.replace('﻿', ''), '작성일시(KST),멤버,부서,구분,타입,수정됨,내용')
})

test('정합성: 월집계 writerCount == distinct(리스트 user)', () => {
  const rows = [
    { user_id: 'u1', log_date: '2026-06-16', entry_type: 'done' as EntryType },
    { user_id: 'u2', log_date: '2026-06-16', entry_type: 'done' as EntryType },
    { user_id: 'u1', log_date: '2026-06-16', entry_type: 'note' as EntryType },
  ]
  const agg = aggregateMonth(rows, 10)
  const distinctUsers = new Set(rows.filter((r) => r.log_date === '2026-06-16').map((r) => r.user_id))
  assert.equal(agg.byDate['2026-06-16'].writerCount, distinctUsers.size)
})
