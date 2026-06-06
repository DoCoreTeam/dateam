'use client'

import { useState, useMemo } from 'react'
import { Pencil, ChevronUp, ChevronDown, ChevronsUpDown, Search } from 'lucide-react'
import RoleToggle from './RoleToggle'
import ResetPasswordButton from './ResetPasswordButton'
import DeleteUserButton from './DeleteUserButton'
import EditProfileModal from './EditProfileModal'
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

type SortKey = 'name' | 'rank' | 'role' | 'created_at'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} style={{ opacity: 0.35 }} />
  return sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
}

export default function UserTable({ profiles, emailMap, currentUserId, ranks, positions }: Props) {
  const [editTarget, setEditTarget] = useState<Profile | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'member'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return profiles
      .filter(p => {
        if (roleFilter !== 'all' && p.role !== roleFilter) return false
        if (!q) return true
        const email = (emailMap[p.id] ?? '').toLowerCase()
        return (p.name ?? '').toLowerCase().includes(q) || email.includes(q) || (p.rank ?? '').includes(q)
      })
      .sort((a, b) => {
        let va = '', vb = ''
        if (sortKey === 'name') { va = a.name ?? ''; vb = b.name ?? '' }
        else if (sortKey === 'rank') { va = a.rank ?? ''; vb = b.rank ?? '' }
        else if (sortKey === 'role') { va = a.role; vb = b.role }
        else if (sortKey === 'created_at') { va = a.created_at; vb = b.created_at }
        const cmp = va.localeCompare(vb, 'ko')
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [profiles, emailMap, search, roleFilter, sortKey, sortDir])

  const thStyle: React.CSSProperties = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }

  return (
    <>
      {/* 검색 / 필터 바 */}
      <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', gap: '0.625rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 0 }}>
          <Search size={14} style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="이름 · 이메일 · 직급 검색"
            className="input-field"
            style={{ paddingLeft: '2rem', fontSize: '0.8125rem', height: '2rem' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          {(['all', 'admin', 'member'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              style={{
                padding: '0.25rem 0.75rem', fontSize: '0.8rem', borderRadius: '999px', cursor: 'pointer',
                border: roleFilter === r ? '1px solid var(--brand)' : '1px solid #e2e8f0',
                background: roleFilter === r ? '#eef2ff' : '#fff',
                color: roleFilter === r ? 'var(--brand-dark)' : '#64748b',
                fontWeight: roleFilter === r ? 600 : 400,
              }}
            >
              {r === 'all' ? '전체' : r}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: 'auto' }}>{filtered.length}명</span>
      </div>

      <table className="table-base table-card">
        <thead>
          <tr>
            <th onClick={() => toggleSort('name')} style={thStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                이름 <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
              </span>
            </th>
            <th onClick={() => toggleSort('rank')} style={thStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                직급 <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} />
              </span>
            </th>
            <th>직책</th>
            <th onClick={() => toggleSort('role')} style={thStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                역할 <SortIcon col="role" sortKey={sortKey} sortDir={sortDir} />
              </span>
            </th>
            <th>초기PW변경</th>
            <th onClick={() => toggleSort('created_at')} style={thStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                가입일 <SortIcon col="created_at" sortKey={sortKey} sortDir={sortDir} />
              </span>
            </th>
            <th style={{ width: '80px' }}>수정</th>
            <th style={{ width: '120px' }}>역할 변경</th>
            <th style={{ width: '110px' }}>PW초기화</th>
            <th style={{ width: '100px' }}>삭제</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                검색 결과가 없습니다
              </td>
            </tr>
          ) : filtered.map((profile) => {
            const email = emailMap[profile.id] ?? ''
            return (
              <tr key={profile.id}>
                <td className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <div style={{
                      width: '2rem', height: '2rem', borderRadius: '50%',
                      background: profile.role === 'admin'
                        ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                        : 'linear-gradient(135deg, var(--brand), var(--brand))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.75rem', fontWeight: 600, color: 'white', flexShrink: 0,
                    }}>
                      {profile.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500 }}>{profile.name || '-'}</div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{email}</div>
                    </div>
                  </div>
                </td>
                <td data-label="직급">
                  <span style={{ fontSize: '0.875rem', color: profile.rank ? '#334155' : '#94a3b8' }}>
                    {profile.rank || '—'}
                  </span>
                </td>
                <td data-label="직책">
                  <span style={{ fontSize: '0.875rem', color: profile.position ? '#334155' : '#94a3b8' }}>
                    {profile.position || '—'}
                  </span>
                </td>
                <td data-label="역할">
                  <span className={`badge ${profile.role === 'admin' ? 'badge-indigo' : 'badge-slate'}`}
                    style={profile.role === 'admin' ? { backgroundColor: '#fef2f2', color: '#dc2626' } : undefined}>
                    {profile.role}
                  </span>
                </td>
                <td data-label="초기PW">
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 600,
                    color: profile.must_change_password ? '#d97706' : '#16a34a',
                  }}>
                    {profile.must_change_password ? '대기중' : '완료'}
                  </span>
                </td>
                <td data-label="가입일">
                  <span style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                    {new Date(profile.created_at).toLocaleDateString('ko-KR')}
                  </span>
                </td>
                <td data-label="수정">
                  <button
                    onClick={() => setEditTarget(profile)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.25rem',
                      padding: '0.3rem 0.6rem', background: '#f1f5f9', color: '#475569',
                      border: '1px solid #e2e8f0', borderRadius: '0.4rem',
                      fontSize: '0.8rem', cursor: 'pointer',
                    }}
                  >
                    <Pencil size={12} /> 수정
                  </button>
                </td>
                <td data-label="역할 변경">
                  <RoleToggle userId={profile.id} currentRole={profile.role} isSelf={profile.id === currentUserId} />
                </td>
                <td data-label="PW초기화">
                  <ResetPasswordButton
                    userId={profile.id}
                    userEmail={email}
                    userName={profile.name ?? '-'}
                  />
                </td>
                <td data-label="삭제">
                  <DeleteUserButton userId={profile.id} userName={profile.name ?? profile.id} isSelf={profile.id === currentUserId} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

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
