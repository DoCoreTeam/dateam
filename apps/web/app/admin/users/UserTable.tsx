'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
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

export default function UserTable({ profiles, emailMap, currentUserId, ranks, positions }: Props) {
  const [editTarget, setEditTarget] = useState<Profile | null>(null)

  return (
    <>
      <table className="table-base table-card">
        <thead>
          <tr>
            <th>이름</th>
            <th>직급</th>
            <th>직책</th>
            <th>역할</th>
            <th>초기PW변경</th>
            <th>가입일</th>
            <th style={{ width: '80px' }}>수정</th>
            <th style={{ width: '120px' }}>역할 변경</th>
            <th style={{ width: '110px' }}>PW초기화</th>
            <th style={{ width: '100px' }}>삭제</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => {
            const email = emailMap[profile.id] ?? ''
            return (
              <tr key={profile.id}>
                <td className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <div style={{
                      width: '2rem', height: '2rem', borderRadius: '50%',
                      background: profile.role === 'admin'
                        ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                        : 'linear-gradient(135deg, #6366f1, #818cf8)',
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
