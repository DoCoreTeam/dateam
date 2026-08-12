'use client'

// app/admin/daily-logs/DayDetailPanel.tsx — 선택일 상세(목록 표준 §2-6)
//
// 검색·정렬·필터·페이지는 URL이 진실이다(useListQuery). 서버 컴포넌트가 그 URL을 읽어
// 다시 조회하므로, 표현 계층만 표준 부품으로 옮기고 데이터 흐름은 그대로 둔다.
// date·month를 filterKeys에 넣는 이유: 목록 조작이 선택한 날짜/달을 날리면 안 된다.

import { Download } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import {
  type DayDetail,
  type EntryType,
  type MonitoringLogRow,
  formatKstDateTime,
} from '@/lib/admin/daily-monitoring'
import type { DayLogFilters } from '@/lib/admin/daily-monitoring-queries'

/** entry_type 라벨 + 아이콘 (색은 .badge[data-status] CSS 토큰에서 — 하드코딩 금지) */
const ENTRY_LABELS: Record<EntryType, { label: string; icon: string }> = {
  done: { label: '완료', icon: '✅' },
  doing: { label: '진행중', icon: '🔄' },
  planned: { label: '예정', icon: '📋' },
  blocker: { label: '블로커', icon: '🚫' },
  note: { label: '메모', icon: '📌' },
}
const ENTRY_VALUES: EntryType[] = ['done', 'doing', 'planned', 'blocker', 'note']

// 서버가 DEFAULT_PAGE_SIZE(50)로 고정 조회한다 → 개수 선택은 감춘다(안 먹는 선택지 금지)
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'logged_at', dir: 'desc' },
  view: 'table',
  size: 50,
  filterKeys: ['dept', 'type', 'kind', 'blocker', 'date', 'month'],
}

const SORT_OPTIONS = [
  { key: 'logged_at', label: '작성일시' },
  { key: 'name', label: '멤버' },
  { key: 'department', label: '부서' },
  { key: 'entry_type', label: '타입' },
]

const COLUMNS: ColumnDef<MonitoringLogRow>[] = [
  {
    key: 'logged_at', header: '작성일시', primary: true, sortable: 'logged_at', width: '150px',
    cell: (row) => (
      <>
        <span className="monitor-time">{formatKstDateTime(row.loggedAt)}</span>
        {row.isEdited && <span className="monitor-edited">수정됨</span>}
      </>
    ),
  },
  { key: 'name', header: '멤버', sortable: 'name', width: '110px', cell: (row) => row.authorName },
  {
    key: 'department', header: '부서', sortable: 'department', width: '120px',
    cell: (row) => (
      <span className={row.departmentName ? '' : 'monitor-muted'}>{row.departmentName ?? '—'}</span>
    ),
  },
  {
    key: 'entry_type', header: '타입', sortable: 'entry_type', width: '100px',
    cell: (row) => {
      const meta = ENTRY_LABELS[row.entryType] ?? ENTRY_LABELS.note
      return <span className="badge" data-status={row.entryType}>{meta.icon} {meta.label}</span>
    },
  },
  {
    key: 'content', header: '내용',
    cell: (row) => <p className="monitor-content">{row.content}</p>,
  },
]

interface Props {
  detail: DayDetail
  departments: { id: string; name: string }[]
  month: string
  filters: DayLogFilters
}

export default function DayDetailPanel({ detail, departments, month, filters }: Props) {
  const { query, set } = useListQuery(LIST_DEFAULTS)

  const listFilters: ListFilterDef[] = [
    { key: 'dept', label: '부서', options: departments.map((d) => ({ value: d.id, label: d.name })) },
    {
      key: 'type',
      label: '타입',
      options: ENTRY_VALUES.map((t) => ({ value: t, label: `${ENTRY_LABELS[t].icon} ${ENTRY_LABELS[t].label}` })),
    },
    { key: 'kind', label: '구분', options: [{ value: 'personal', label: '개인' }, { value: 'dept_task', label: '부서' }] },
    { key: 'blocker', label: '블로커', options: [{ value: '1', label: '블로커만' }] },
  ]

  // CSV 내보내기 — 선택일 + 현재 필터(검색 q 포함). export 라우트가 q를 동일 기준으로 반영.
  const exportHref = (() => {
    const sp = new URLSearchParams({ from: detail.date, to: detail.date })
    if (filters.q) sp.set('q', filters.q)
    if (filters.departmentId) sp.set('dept', filters.departmentId)
    if (filters.entryType) sp.set('type', filters.entryType)
    if (filters.taskKind) sp.set('kind', filters.taskKind)
    if (filters.blockerOnly) sp.set('blocker', '1')
    return `/admin/daily-logs/export?${sp.toString()}`
  })()

  const hasFilters = Boolean(
    query.q || filters.departmentId || filters.entryType || filters.taskKind || filters.blockerOnly,
  )

  return (
    <section className="monitor-panel" aria-label="선택일 상세">
      {/* KPI 요약 줄 */}
      <div className="monitor-kpi">
        <strong className="monitor-kpi-date">{detail.date}</strong>
        <span className="monitor-kpi-item">
          작성 <b>{detail.writerCount}</b>/{detail.totalActiveMembers}명
        </span>
        <span className="monitor-kpi-sep">·</span>
        <span className="monitor-kpi-item">
          미작성 <b>{detail.missingMembers.length}</b>
        </span>
        <span className="monitor-kpi-sep">·</span>
        <span className={`monitor-kpi-item${detail.blockerCount > 0 ? ' is-danger' : ''}`}>
          블로커 <b>{detail.blockerCount}</b>
        </span>
        {filters.q ? (
          <span className="monitor-kpi-hint">작성 현황은 검색어와 무관 · 아래 목록만 “{filters.q}” 검색</span>
        ) : null}
      </div>

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="내용 검색"
        filters={listFilters}
        sortOptions={SORT_OPTIONS}
        showSize={false}
        total={detail.total}
        actions={
          <a href={exportHref} className="btn-ghost" download aria-label="선택일 CSV 내보내기">
            <Download size={14} /> CSV
          </a>
        }
      />

      <ListSurface
        rows={detail.rows}
        columns={COLUMNS}
        query={query}
        rowKey={(row) => row.id}
        onChange={set}
        empty={hasFilters
          ? { title: '조건에 맞는 기록이 없어요', description: '검색어나 필터를 바꿔보세요' }
          : { title: `${detail.date}에 작성된 일일업무가 없어요`, description: '달력에서 다른 날짜를 선택해보세요' }}
      />

      <ListPager query={query} total={detail.total} onChange={set} />

      {/* 미작성자 */}
      <div className="monitor-missing" data-month={month}>
        {detail.missingMembers.length === 0 ? (
          <span className="monitor-missing-ok">전원 작성 완료</span>
        ) : (
          <>
            <span className="monitor-missing-label">미작성({detail.missingMembers.length})</span>
            <span className="monitor-missing-chips">
              {detail.missingMembers.map((m) => (
                <span key={m.id} className="monitor-missing-chip">
                  {m.name}
                </span>
              ))}
            </span>
          </>
        )}
      </div>
    </section>
  )
}
