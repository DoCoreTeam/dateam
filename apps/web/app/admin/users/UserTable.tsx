'use client'

// app/admin/users/UserTable.tsx — 구성원 목록
// 목록 표준(§2-6)을 따른다. 데이터는 서버가 전부 넘겨주므로(수백 명 규모)
// 검색·정렬·필터는 클라이언트에서 처리하되, **조건은 URL이 진실**이다.

import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import RoleToggle from './RoleToggle'
import ResetPasswordButton from './ResetPasswordButton'
import ResetMfaButton from './ResetMfaButton'
import ResetOnboardingButton from './ResetOnboardingButton'
import DeleteUserButton from './DeleteUserButton'
import ResignButton from './ResignButton'
import EditProfileModal from './EditProfileModal'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import RowActions from '@/components/ui/list/RowActions'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import { employmentMap, isResignScheduled, type EmploymentRow } from '@/lib/members/employment'
import { EMPLOYMENT_FIELD, RESIGNED_TAB, ENTITY } from '@/lib/terms'
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
  /** 재직 기록. 행이 없는 사람은 재직으로 읽는다(lib/members/employment) */
  employment: EmploymentRow[]
  /**
   * 어느 목록인가. 서버가 이미 갈라서 넘기므로 여기서 다시 거르지 않는다 —
   * 거르개를 또 두면 탭과 뜻이 겹쳐 어느 쪽이 이겼는지 알 수 없다.
   */
  mode: 'active' | 'resigned'
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

export default function UserTable({ profiles, emailMap, currentUserId, ranks, positions, employment, mode }: Props) {
  // 탭마다 저장 자리를 나눈다 — 한쪽에서 정한 정렬이 다른 쪽까지 따라가면 왜 그런지 알 수 없다
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: `/admin/users?${mode}` })
  const [editTarget, setEditTarget] = useState<Profile | null>(null)

  const empMap = useMemo(() => employmentMap(employment), [employment])
  const isResignedList = mode === 'resigned'

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

  const RESIGNED_ONLY_COLUMN: ColumnDef<Profile> = {
    key: 'resigned_on', header: EMPLOYMENT_FIELD.resignedOn, hideOnCard: false,
    cell: (p) => (
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
        {empMap.get(p.id)?.resigned_on ?? '—'}
      </span>
    ),
  }

  const allColumns: ColumnDef<Profile>[] = [
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
            {/* 퇴사 표시는 안 단다 — 탭이 이미 그 말을 하고 있어서 한 줄에 같은 말이 두 번 된다.
                대신 **아직 안 온 퇴사일**은 여기 적는다. 재직 목록에 있으면서 곧 나가는 사람이라,
                그 사실을 모르면 담당자로 새로 지정해 버린다. */}
            <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              {p.name || '-'}
              {isResignScheduled(empMap.get(p.id)) && (
                <span className="badge badge-slate" title={`${EMPLOYMENT_FIELD.resignedOn} ${empMap.get(p.id)?.resigned_on}`}>
                  {RESIGNED_TAB.scheduledLabel} {empMap.get(p.id)?.resigned_on}
                </span>
              )}
            </span>
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
    ...(isResignedList ? [RESIGNED_ONLY_COLUMN] : ([] as ColumnDef<Profile>[])),
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
      // 액션이 수정·역할변경·PW초기화·온보딩·삭제로 다섯이다. 한 줄에 늘어놓으면 좁은 칸에서
      // 다섯 줄로 접혀 행이 216px가 됐다(다른 정보는 50px). RowActions가 주요 하나만 남기고 접는다.
      key: 'actions', header: '관리', width: '120px', noLabel: true,
      cell: (p) => (
        <RowActions subject={p.name ?? '구성원'}>
          <button type="button" className="btn-ghost" onClick={() => setEditTarget(p)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>
            <Pencil size={12} /> 수정
          </button>
          <RoleToggle userId={p.id} currentRole={p.role} isSelf={p.id === currentUserId} />
          <ResetPasswordButton userId={p.id} userEmail={emailMap[p.id] ?? ''} userName={p.name ?? '-'} />
          <ResetMfaButton userId={p.id} userName={p.name ?? '-'} />
          <ResetOnboardingButton userId={p.id} userName={p.name ?? '-'} />
          <ResignButton userId={p.id} userName={p.name ?? p.id} isSelf={p.id === currentUserId} isResigned={isResignedList} />
          <DeleteUserButton userId={p.id} userName={p.name ?? p.id} isSelf={p.id === currentUserId} />
        </RowActions>
      ),
    },
    {
      // 온보딩 상태는 액션이 아니라 **정보**다 — 버튼과 분리해 상태 칸으로 남긴다.
      key: 'onboarding', header: '온보딩', width: '90px', hideOnCard: true,
      cell: (p) => (
        <span style={{
          fontSize: 'var(--fs-2xs)', fontWeight: 600, whiteSpace: 'nowrap',
          color: p.onboarding_completed_at ? 'var(--success)' : p.onboarding_skipped_at ? 'var(--text-muted)' : 'var(--warning)',
        }}>
          {p.onboarding_completed_at ? '완료' : p.onboarding_skipped_at ? '건너뜀' : '미완료'}
        </span>
      ),
    },
  ]
  // 퇴사한 사람에게 초기 비밀번호 상태와 온보딩 진행은 물어볼 것이 아니다
  const columns = allColumns.filter(
    (c) => !(isResignedList && (c.key === 'must_change_password' || c.key === 'onboarding')),
  )

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
        counter={ENTITY.person.counter}
      />

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        rowKey={(p) => p.id}
        rowHref={(p) => `/admin/members/${p.id}`}
        onChange={set}
        empty={hasFilters
          ? { title: '조건에 맞는 구성원이 없어요', description: '검색어나 역할 필터를 바꿔보세요' }
          : isResignedList
            ? { title: RESIGNED_TAB.emptyTitle, description: RESIGNED_TAB.emptyDescription }
            : { title: '등록된 구성원이 없어요', description: '구성원을 추가하면 여기 표시됩니다' }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} counter={ENTITY.person.counter} />

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
