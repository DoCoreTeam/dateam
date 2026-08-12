'use client'

// app/admin/kpi/KpiLogTable.tsx — 전체 KPI 로그(목록 표준 §2-6)
//
// 서버가 기간으로 조회한 행을 그대로 받는다(데이터 흐름 무변경). 표현만 표준 부품으로.
// period_start·period_end를 filterKeys에 두어 목록 조작이 기간 선택을 날리지 않게 한다.

import { useMemo } from 'react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import { rateColor } from './rate-color'

export interface KpiLogRow {
  id: string
  userName: string
  metricName: string
  value: number
  unit: string | null
  /** 목표 대비 달성률(%) — 목표가 없으면 null */
  rate: number | null
  periodStart: string
  periodEnd: string
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'periodEnd', dir: 'desc' },
  view: 'table',
  size: 20,
  filterKeys: ['period_start', 'period_end'],
}

const SORT_OPTIONS = [
  { key: 'periodEnd', label: '기간' },
  { key: 'userName', label: '팀원' },
  { key: 'metricName', label: 'KPI 항목' },
  { key: 'value', label: '실적' },
]

const COLUMNS: ColumnDef<KpiLogRow>[] = [
  {
    key: 'userName', header: '팀원', primary: true, sortable: 'userName', width: '130px',
    cell: (e) => <span style={{ fontWeight: 600, color: 'var(--text)' }}>{e.userName}</span>,
  },
  {
    key: 'metricName', header: 'KPI 항목', sortable: 'metricName',
    cell: (e) => <span style={{ color: 'var(--text)' }}>{e.metricName}</span>,
  },
  {
    key: 'value', header: '실적', sortable: 'value', align: 'right', width: '130px',
    cell: (e) => (
      <>
        <strong style={{ color: 'var(--text)' }}>{e.value.toLocaleString()}</strong>
        {e.unit && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginLeft: '0.25rem' }}>{e.unit}</span>}
      </>
    ),
  },
  {
    key: 'rate', header: '달성률', width: '100px',
    cell: (e) => e.rate === null
      ? <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>-</span>
      : (
        <span className="badge" style={{ ...rateColor(e.rate), fontSize: 'var(--fs-xs)', fontWeight: 700 }}>
          {e.rate}%
        </span>
      ),
  },
  {
    key: 'period', header: '기간', width: '190px',
    cell: (e) => (
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{e.periodStart} ~ {e.periodEnd}</span>
    ),
  },
]

export default function KpiLogTable({ entries }: { entries: KpiLogRow[] }) {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/admin/kpi' })

  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    return entries
      .filter((e) => !q || e.userName.toLowerCase().includes(q) || e.metricName.toLowerCase().includes(q))
      .sort((a, b) => {
        const cmp = query.sort.key === 'value'
          ? a.value - b.value
          : query.sort.key === 'userName'
            ? a.userName.localeCompare(b.userName, 'ko')
            : query.sort.key === 'metricName'
              ? a.metricName.localeCompare(b.metricName, 'ko')
              : a.periodEnd.localeCompare(b.periodEnd)
        return query.sort.dir === 'asc' ? cmp : -cmp
      })
  }, [entries, query.q, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="팀원 또는 KPI 항목 검색"
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />

      <ListSurface
        rows={rows}
        columns={COLUMNS}
        query={query}
        rowKey={(e) => e.id}
        onChange={set}
        empty={query.q
          ? { title: '조건에 맞는 KPI 기록이 없어요', description: '검색어를 바꿔보세요' }
          : { title: '해당 기간에 입력된 KPI가 없어요', description: '기간을 넓히거나 팀원에게 KPI 입력을 요청하세요' }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} />
    </>
  )
}
