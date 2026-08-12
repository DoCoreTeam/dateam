'use client'

// app/(member)/operations/RrMatrixTable.tsx — R&R 매트릭스 표면
// 화면이 <table>을 직접 짜지 않는다(§2-6). 검색·정렬·페이지가 없는 고정 매트릭스라
// URL 상태는 만들지 않고, 표/카드 렌더러(ListSurface)만 재사용한다.

import { useMemo } from 'react'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { resolveListQuery } from '@/lib/ui/list-query'

const RR_HEADERS = ['프로젝트', 'PM', '개발 PM', '백엔드', '프론트', '지원']

interface Row { id: string; cells: string[] }

export default function RrMatrixTable({ rows }: { rows: string[][] }) {
  const query = useMemo(
    () => resolveListQuery(new URLSearchParams(), { sort: { key: 'c0', dir: 'asc' }, view: 'table' }),
    [],
  )

  const columns: ColumnDef<Row>[] = RR_HEADERS.map((header, i) => ({
    key: `c${i}`,
    header,
    primary: i === 0,
    cell: (r) => r.cells[i]
      ? <span style={{ color: i === 0 ? 'var(--text)' : 'var(--text-muted)', fontWeight: i === 0 ? 600 : 400 }}>{r.cells[i]}</span>
      : <span style={{ color: 'var(--text-faint)' }}>—</span>,
  }))

  const data: Row[] = rows.map((cells, i) => ({ id: String(i), cells }))

  return (
    <ListSurface
      rows={data}
      columns={columns}
      query={query}
      rowKey={(r) => r.id}
      empty={{ title: 'R&R 매트릭스가 없어요', description: '관리자가 조직 R&R을 등록하면 여기에 표시됩니다' }}
    />
  )
}
