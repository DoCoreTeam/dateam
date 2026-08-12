'use client'

// app/admin/users/UserTable.tsx — 구성원 목록
// 목록 표준(§2-6)을 따른다. 데이터는 서버가 전부 넘겨주므로(수백 명 규모)
// 검색·정렬·필터는 클라이언트에서 처리하되, **조건은 URL이 진실**이다.

import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import RoleToggle from './RoleToggle'
import ResetPasswordButton from './ResetPasswordButton'
import ResetOnboardingButton from './ResetOnboardingButton'
import DeleteUserButton from './DeleteUserButton'
import EditProfileModal from './EditProfileModal'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import type { Profile } from '@/types/database'

interface RankItem {
  id: number
  name: string
  display_order: number
}

interface Props {
  profiles: Profile[]
  emailMap: Record<string, string>
  currentUserId: string
  ranks: RankItem[]
  positions: RankItem[]
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'name', dir: 'asc' },
  view: 'table',
  size: 50,
  filterKeys: ['role'],
}
const SORT_OPTIONS = [
  { key: 'name', label: '이름' },
  { key: 'rank', label: '직급' },
  { key: 'role', label: '역할' },
  { key: 'created_at', label: '가입일' },
]
const FILTERS = [{
  key: 'role',
  label: '역할',
  options: [{ value: 'admin', label: 'admin' }, { value: 'member', label: 'member' }],
}]

function sortValue(p: Profile, key: string): string {
  if (key === 'rank') return p.rank ?? ''
  if (key === 'role') return p.role
  if (key === 'created_at') return p.created_at
  return p.name ?? ''
}

export default function UserTable({ profiles, emailMap, currentUserId, ranks, positions }: Props) {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/admin/users' })
  const [editTarget, setEditTarget] = useState<Profile | null>(null)

  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    const role = query.filters.role
    return profiles
      .filter((p) => {
        if (role && p.role !== role) return false
        if (!q) return true
        const email = (emailMap[p.id] ?? '').toLowerCase()
        return (p.name ?? '').toLowerCase().includes(q) || email.includes(q) || (p.rank ?? '').includes(q)
      })
      .sort((a, b) => {
        const cmp = sortValue(a, query.sort.key).localeCompare(sortValue(b, query.sort.key), 'ko')
        return query.sort.dir === 'asc' ? cmp : -cmp
      })
  }, [profiles, emailMap, query.q, query.filters.role, query.sort.key, query.sort.dir])

  // 전체를 한 번에 그리지 않는다 — 화면에 필요한 구간만 자른다
  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)

  const columns: ColumnDef<Profile>[] = [
    {
      key: 'name', header: '이름', primary: true, sortable: 'name',
      cell: (p) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span style={{
            width: '2rem', height: '2rem', borderRadius: '50%',
            background: p.role === 'admin' ? 'var(--danger)' : 'var(--brand)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--brand-fg)', flexShrink: 0,
          }}>
            {p.name?.charAt(0)?.toUpperCase() ?? '?'}
          </span>
          <span>
            <span style={{ fontWeight: 500, display: 'block' }}>{p.name || '-'}</span>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{emailMap[p.id] ?? ''}</span>
          </span>
        </div>
      ),
    },
    { key: 'rank', header: '직급', sortable: 'rank', cell: (p) => p.rank || '—' },
    { key: 'position', header: '직책', cell: (p) => p.position || '—' },
    {
      key: 'role', header: '역할', sortable: 'role',
      cell: (p) => (
        <span className={`badge ${p.role === 'admin' ? 'badge-indigo' : 'badge-slate'}`}
          style={p.role === 'admin' ? { backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' } : undefined}>
          {p.role}
        </span>
      ),
    },
    {
      key: 'must_change_password', header: '초기PW변경', hideOnCard: true,
      cell: (p) => (
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: p.must_change_password ? 'var(--warning)' : 'var(--success)' }}>
          {p.must_change_password ? '대기중' : '완료'}
        </span>
      ),
    },
    {
      key: 'created_at', header: '가입일', sortable: 'created_at', hideOnCard: true,
      cell: (p) => (
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
          {new Date(p.created_at).toLocaleDateString('ko-KR')}
        </span>
      ),
    },
    {
      key: 'edit', header: '수정', width: '80px',
      cell: (p) => (
        <button type="button" className="btn-ghost" onClick={() => setEditTarget(p)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)' }}>
          <Pencil size={12} /> 수정
        </button>
      ),
    },
    {
      key: 'role_toggle', header: '역할 변경', width: '120px',
      cell: (p) => <RoleToggle userId={p.id} currentRole={p.role} isSelf={p.id === currentUserId} />,
    },
    {
      key: 'reset_pw', header: 'PW초기화', width: '110px',
      cell: (p) => <ResetPasswordButton userId={p.id} userEmail={emailMap[p.id] ?? ''} userName={p.name ?? '-'} />,
    },
    {
      key: 'onboarding', header: '온보딩', width: '130px',
      cell: (p) => (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', alignItems: 'flex-start' }}>
          <span style={{
            fontSize: 'var(--fs-2xs)', fontWeight: 600,
            color: p.onboarding_completed_at ? 'var(--success)' : p.onboarding_skipped_at ? 'var(--text-muted)' : 'var(--warning)',
          }}>
            {p.onboarding_completed_at ? '완료' : p.onboarding_skipped_at ? '건너뜀' : '미완료'}
          </span>
          <ResetOnboardingButton userId={p.id} userName={p.name ?? '-'} />
        </span>
      ),
    },
    {
      key: 'delete', header: '삭제', width: '100px',
      cell: (p) => <DeleteUserButton userId={p.id} userName={p.name ?? p.id} isSelf={p.id === currentUserId} />,
    },
  ]

  const hasFilters = Boolean(query.q || query.filters.role)

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="이름 · 이메일 · 직급 검색"
        filters={FILTERS}
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        rowKey={(p) => p.id}
        onChange={set}
        empty={hasFilters
          ? { title: '조건에 맞는 구성원이 없어요', description: '검색어나 역할 필터를 바꿔보세요' }
          : { title: '등록된 구성원이 없어요', description: '구성원을 추가하면 여기 표시됩니다' }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} />

      {editTarget && (
        <EditProfileModal
          userId={editTarget.id}
          defaultName={editTarget.name ?? ''}
          defaultRank={editTarget.rank}
          defaultPosition={editTarget.position}
          ranks={ranks}
          positions={positions}
          onClose={() => setEditTarget(null)}
        />
      )}
    </>
  )
}
