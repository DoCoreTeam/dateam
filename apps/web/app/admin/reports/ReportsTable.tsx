'use client'

// app/admin/reports/ReportsTable.tsx — 원본 멤버 보고 목록(목록 표준 §2-6)
//
// 서버 페이지가 주차·스코프로 이미 조회한 행을 그대로 받는다(데이터 흐름 무변경).
// 검색·정렬·보기·페이지만 URL에 싣는다 — 링크를 공유하면 같은 화면이 열린다.
// week·sel·member를 filterKeys에 두는 이유: 목록 조작이 주차/스코프를 날리면 안 된다.

import { useMemo } from 'react'
import RichText from '@/components/ui/RichText'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'

export interface ReportRow {
  id: string
  userName: string
  category: string
  performance: string
  plan: string
  issues: string
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'category', dir: 'asc' },
  view: 'table',
  size: 20,
  filterKeys: ['week', 'sel', 'member'],
}

const SORT_OPTIONS = [
  { key: 'category', label: '구분' },
  { key: 'userName', label: '팀원' },
]

function RichCell({ html }: { html: string }) {
  return <RichText html={html} style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6 }} />
}

const COLUMNS: ColumnDef<ReportRow>[] = [
  {
    key: 'userName', header: '팀원', primary: true, sortable: 'userName', width: '120px',
    cell: (r) => <span style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{r.userName}</span>,
  },
  {
    key: 'category', header: '구분', sortable: 'category', width: '90px',
    cell: (r) => <span className="badge badge-indigo">{r.category}</span>,
  },
  { key: 'performance', header: '성과', cell: (r) => <RichCell html={r.performance} /> },
  { key: 'plan', header: '계획', cell: (r) => <RichCell html={r.plan} /> },
  { key: 'issues', header: '이슈/협조사항', cell: (r) => <RichCell html={r.issues} /> },
]

export default function ReportsTable({ rows }: { rows: ReportRow[] }) {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/admin/reports' })

  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    const key = query.sort.key === 'userName' ? 'userName' : 'category'
    return rows
      .filter((r) => !q || r.userName.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      .sort((a, b) => {
        const cmp = a[key].localeCompare(b[key], 'ko')
        return query.sort.dir === 'asc' ? cmp : -cmp
      })
  }, [rows, query.q, query.sort.key, query.sort.dir])

  // 화면에 필요한 구간만 자른다(무한 렌더 방지)
  const { from, to } = rangeOf(query)
  const page = filtered.slice(from, to + 1)

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="팀원 또는 구분 검색"
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />

      <ListSurface
        rows={page}
        columns={COLUMNS}
        query={query}
        rowKey={(r) => r.id}
        onChange={set}
        empty={query.q
          ? { title: '조건에 맞는 보고가 없어요', description: '검색어를 바꿔보세요' }
          : { title: '해당 주차에 작성된 주간보고가 없어요', description: '다른 주차를 선택하거나 팀원에게 작성을 요청하세요' }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} />
    </>
  )
}
