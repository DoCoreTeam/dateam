'use client'

// app/admin/api/AccessRequestsPanel.tsx — API 접근 신청 목록
//
// 목록 표준(§2-6)을 따른다. 데이터는 서버(page.tsx)가 전부 넘겨주므로 조회는 그대로 두고
// 표현만 표준 부품으로 옮겼다 — 화면이 <table>·빈 상태 문구를 직접 짜지 않는다.
// `tab`을 filterKeys에 넣는 이유: listQueryToParams가 목록 파라미터만 다시 쓰기 때문에,
// 필터로 등록해두지 않으면 정렬·검색할 때 `?tab=keys`가 통째로 날아간다.

import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults, type ListQuery } from '@/lib/ui/list-query'
import ApproveRejectButtons from '../api-access/ApproveRejectButtons'

export interface AccessRequest {
  id: string
  email: string
  name: string
  company: string | null
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  notes: string | null
  created_at: string
  approved_at: string | null
  rejected_at: string | null
  temp_password: string | null
}

interface Props {
  pending: AccessRequest[]
  processed: AccessRequest[]
}

/** 대기 큐는 조건 없이 전부 보여준다 — 처리해야 할 것을 숨기지 않는다 */
const QUEUE_QUERY: ListQuery = {
  q: '', sort: { key: 'created_at', dir: 'desc' }, filters: {},
  view: 'table', size: 100, mode: 'pages', page: 1,
}

const PROCESSED_DEFAULTS: ListDefaults = {
  sort: { key: 'processed_at', dir: 'desc' },
  view: 'table',
  size: 20,
  filterKeys: ['tab', 'status'],
}

const STATUS_FILTER = [{
  key: 'status',
  label: '상태',
  options: [{ value: 'approved', label: '승인' }, { value: 'rejected', label: '거절' }],
}]

const SORT_OPTIONS = [
  { key: 'processed_at', label: '처리일' },
  { key: 'name', label: '신청자' },
]

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('ko-KR')
}

function processedAt(r: AccessRequest) {
  return r.approved_at ?? r.rejected_at ?? r.created_at
}

function applicant(r: AccessRequest) {
  return (
    <span>
      <span style={{ fontWeight: 600, display: 'block' }}>{r.name}</span>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{r.email}</span>
    </span>
  )
}

export default function AccessRequestsPanel({ pending, processed }: Props) {
  const { query, set } = useListQuery(PROCESSED_DEFAULTS, { persistKey: '/admin/api#access' })

  const pendingColumns: ColumnDef<AccessRequest>[] = [
    { key: 'name', header: '신청자', primary: true, cell: applicant },
    { key: 'company', header: '회사', cell: (r) => r.company ?? '—' },
    {
      key: 'reason', header: '활용 목적', width: '280px',
      cell: (r) => (
        <span style={{
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.5,
        }}>
          {r.reason}
        </span>
      ),
    },
    {
      key: 'created_at', header: '신청일', hideOnCard: true,
      cell: (r) => <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{fmtDate(r.created_at)}</span>,
    },
    { key: 'actions', header: '처리', cell: (r) => <ApproveRejectButtons requestId={r.id} /> },
  ]

  const processedColumns: ColumnDef<AccessRequest>[] = [
    { key: 'name', header: '신청자', primary: true, sortable: 'name', cell: applicant },
    { key: 'company', header: '회사', cell: (r) => r.company ?? '—' },
    {
      key: 'status', header: '상태',
      cell: (r) => (
        <span className="badge" data-status={r.status === 'approved' ? 'done' : 'blocker'}>
          {r.status === 'approved' ? '승인' : '거절'}
        </span>
      ),
    },
    {
      key: 'processed_at', header: '처리일', sortable: 'processed_at',
      cell: (r) => <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{fmtDate(processedAt(r))}</span>,
    },
    {
      key: 'notes', header: '비고', hideOnCard: true,
      cell: (r) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{r.notes ?? '—'}</span>,
    },
  ]

  const q = query.q.trim().toLowerCase()
  const statusFilter = query.filters.status
  const filtered = processed
    .filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (!q) return true
      return `${r.name} ${r.email} ${r.company ?? ''}`.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const cmp = query.sort.key === 'name'
        ? (a.name ?? '').localeCompare(b.name ?? '', 'ko')
        : processedAt(a).localeCompare(processedAt(b))
      return query.sort.dir === 'asc' ? cmp : -cmp
    })

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)
  const narrowed = Boolean(q || statusFilter)

  return (
    <>
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{
          padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        }}>
          <h2 className="tape-title" style={{ margin: 0 }}>대기 중</h2>
          <span className="badge" data-status="note">{pending.length}건</span>
        </div>
        <ListSurface
          rows={pending}
          columns={pendingColumns}
          query={QUEUE_QUERY}
          rowKey={(r) => r.id}
          empty={{
            title: '대기 중인 신청이 없어요',
            description: '새 신청이 들어오면 여기에서 승인·거절할 수 있습니다',
          }}
        />
      </div>

      <div className="card">
        <div style={{
          padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        }}>
          <h2 className="tape-title" style={{ margin: 0 }}>처리 완료</h2>
        </div>
        <ListToolbar
          query={query}
          onChange={set}
          searchPlaceholder="신청자 · 이메일 · 회사 검색"
          filters={STATUS_FILTER}
          sortOptions={SORT_OPTIONS}
          total={filtered.length}
        />
        <ListSurface
          rows={rows}
          columns={processedColumns}
          query={query}
          rowKey={(r) => r.id}
          onChange={set}
          empty={narrowed
            ? { title: '조건에 맞는 신청이 없어요', description: '검색어나 상태 필터를 바꿔보세요' }
            : { title: '처리한 신청이 없어요', description: '대기 중 신청을 승인·거절하면 여기에 쌓입니다' }}
        />
        <ListPager query={query} total={filtered.length} onChange={set} />
      </div>
    </>
  )
}
