'use client'

// app/admin/routine/RoutineTable.tsx — 팀원별 루틴 달성률(목록 표준 §2-6)
//
// 달성률 계산은 서버가 끝낸 값을 그대로 받는다(데이터 흐름 무변경).
// 검색·정렬·보기·페이지만 URL에 싣는다. week를 filterKeys에 두어 주차 선택이 날아가지 않게 한다.

import { useMemo } from 'react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'

export interface RoutineItemStat {
  name: string
  freq: 'daily' | 'weekly'
  count: number
  max: number
  rate: number
}

export interface RoutineMemberRow {
  id: string
  name: string
  /** 조직도(루틴 템플릿)에 연결된 멤버인가 — 미연결이면 기본 템플릿으로 계산된다 */
  hasTemplate: boolean
  rate: number
  items: RoutineItemStat[]
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'name', dir: 'asc' },
  view: 'table',
  size: 50,
  filterKeys: ['week'],
}

const SORT_OPTIONS = [
  { key: 'name', label: '팀원' },
  { key: 'rate', label: '달성률' },
]

/** 달성률 색 — 토큰만 사용(테마 전환 자동 대응) */
function rateColor(rate: number): string {
  if (rate >= 70) return 'var(--success)'
  if (rate >= 40) return 'var(--warning)'
  return 'var(--danger)'
}

function itemTone(rate: number): { backgroundColor: string; color: string } {
  if (rate >= 80) return { backgroundColor: 'var(--success-bg)', color: 'var(--success)' }
  if (rate >= 40) return { backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }
  return { backgroundColor: 'var(--color-bg)', color: 'var(--text-muted)' }
}

const COLUMNS: ColumnDef<RoutineMemberRow>[] = [
  {
    key: 'name', header: '팀원', primary: true, sortable: 'name', width: '160px',
    cell: (m) => (
      <div>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{m.name || '-'}</div>
        {!m.hasTemplate && m.name && (
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', marginTop: '2px' }}>
            조직도 미연결
          </div>
        )}
      </div>
    ),
  },
  {
    key: 'items', header: '루틴 항목',
    cell: (m) => (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
        {m.items.map((item) => (
          <span
            key={item.name}
            className="badge"
            style={{ ...itemTone(item.rate), fontSize: 'var(--fs-2xs)' }}
            title={item.freq === 'weekly' ? `${item.count}/1회` : `${item.count}/7일`}
          >
            {item.name} {item.freq === 'weekly' ? (item.rate === 100 ? '✓' : '미완') : `${item.rate}%`}
          </span>
        ))}
      </div>
    ),
  },
  {
    key: 'rate', header: '달성률', sortable: 'rate', align: 'right', width: '110px',
    cell: (m) => (
      <span style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', color: rateColor(m.rate) }}>{m.rate}%</span>
    ),
  },
]

export default function RoutineTable({ members }: { members: RoutineMemberRow[] }) {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/admin/routine' })

  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    return members
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.items.some((i) => i.name.toLowerCase().includes(q)))
      .sort((a, b) => {
        const cmp = query.sort.key === 'rate' ? a.rate - b.rate : a.name.localeCompare(b.name, 'ko')
        return query.sort.dir === 'asc' ? cmp : -cmp
      })
  }, [members, query.q, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="팀원 또는 루틴 항목 검색"
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />

      <ListSurface
        rows={rows}
        columns={COLUMNS}
        query={query}
        rowKey={(m) => m.id}
        onChange={set}
        empty={query.q
          ? { title: '조건에 맞는 팀원이 없어요', description: '검색어를 바꿔보세요' }
          : { title: '표시할 팀원이 없어요', description: '구성원을 등록하면 루틴 달성률이 여기 모입니다', action: { label: '구성원 관리', href: '/admin/users' } }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} />
    </>
  )
}
