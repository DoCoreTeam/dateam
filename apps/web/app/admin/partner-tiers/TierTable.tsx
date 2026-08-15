'use client'

// app/admin/partner-tiers/TierTable.tsx — 등급 목록(목록 표준 §2-6)
//
// 서버가 조회한 등급 전체를 받아 표현만 표준 부품으로 그린다(데이터 흐름 무변경).
// 수정은 목록 위 카드에서 연다 — ListSurface는 행 전체를 폼으로 바꾸는 colSpan 편집을 갖지 않고,
// 그걸 위해 표를 자작하면 표준을 다시 깨는 셈이 된다.

import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import RowActions from '@/components/ui/list/RowActions'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import TierForm from './TierForm'
import DeleteTierButton from './DeleteTierButton'

export interface PartnerTierRow {
  id: string
  name: string
  discount_rate: number
  description: string | null
  created_at: string
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'discount_rate', dir: 'desc' },
  view: 'table',
  size: 20,
}

const SORT_OPTIONS = [
  { key: 'discount_rate', label: '할인율' },
  { key: 'name', label: '등급명' },
  { key: 'created_at', label: '생성일' },
]

export default function TierTable({ tiers }: { tiers: PartnerTierRow[] }) {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/admin/partner-tiers' })
  const [editing, setEditing] = useState<PartnerTierRow | null>(null)

  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    return tiers
      .filter((t) => !q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
      .sort((a, b) => {
        const cmp = query.sort.key === 'discount_rate'
          ? a.discount_rate - b.discount_rate
          : query.sort.key === 'created_at'
            ? a.created_at.localeCompare(b.created_at)
            : a.name.localeCompare(b.name, 'ko')
        return query.sort.dir === 'asc' ? cmp : -cmp
      })
  }, [tiers, query.q, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)

  const columns: ColumnDef<PartnerTierRow>[] = [
    {
      key: 'name', header: '등급명', primary: true, sortable: 'name', width: '160px',
      cell: (t) => <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.name}</span>,
    },
    {
      key: 'discount_rate', header: '할인율', sortable: 'discount_rate', width: '110px',
      cell: (t) => (
        <span className="badge badge-indigo" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {parseFloat(String(t.discount_rate)).toFixed(2)}%
        </span>
      ),
    },
    {
      key: 'description', header: '설명',
      cell: (t) => <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{t.description || '-'}</span>,
    },
    {
      key: 'created_at', header: '생성일', sortable: 'created_at', hideOnCard: true, width: '120px',
      cell: (t) => (
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
          {new Date(t.created_at).toLocaleDateString('ko-KR')}
        </span>
      ),
    },
    {
      // 수정·삭제 둘뿐이어도 170px 칸에서 접혀 행이 119px가 됐다 — 폭을 재서 맞추는 대신
      // RowActions로 접힐 수 없게 만든다(칸 폭이 얼마든 한 줄).
      key: 'actions', header: '관리', width: '120px',
      cell: (t) => (
        <RowActions subject={t.name}>
          <button type="button" className="btn-ghost" onClick={() => setEditing(t)}>
            <Pencil size={13} /> 수정
          </button>
          <DeleteTierButton tierId={t.id} tierName={t.name} />
        </RowActions>
      ),
    },
  ]

  return (
    <>
      {editing && (
        <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: '0 0 var(--space-3)' }}>{editing.name} 수정</h3>
          <TierForm
            key={editing.id}
            mode="edit"
            tierId={editing.id}
            defaultName={editing.name}
            defaultRate={editing.discount_rate}
            defaultDescription={editing.description ?? ''}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="등급명 또는 설명 검색"
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        rowKey={(t) => t.id}
        onChange={set}
        empty={query.q
          ? { title: '조건에 맞는 등급이 없어요', description: '검색어를 바꿔보세요' }
          : { title: '등록된 등급이 없어요', description: '위 “새 등급 추가”에서 첫 등급을 만들어보세요' }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} />
    </>
  )
}
