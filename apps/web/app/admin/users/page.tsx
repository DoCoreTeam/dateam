import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Users, UserPlus } from 'lucide-react'
import RoleToggle from './RoleToggle'
import type { Profile } from '@/types/database'

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: true }) as unknown as { data: Profile[] | null; error: unknown }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          사용자 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          팀원 계정 조회 및 역할 관리
        </p>
      </div>

      {/* 팀원 초대 폼 (TODO: Admin API 구현 필요) */}
      <div
        className="card"
        style={{
          padding: '1.25rem 1.5rem',
          marginBottom: '1.5rem',
          borderLeft: '3px solid #f59e0b',
          backgroundColor: '#fffbeb',
          borderRadius: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <UserPlus size={16} color="#d97706" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#92400e', margin: 0 }}>
            새 팀원 초대
          </h2>
          <span className="badge" style={{ backgroundColor: '#fef3c7', color: '#92400e', fontSize: '0.6875rem' }}>
            TODO
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: '#92400e', margin: '0 0 1rem', lineHeight: 1.6 }}>
          새 팀원 생성은 <code>service_role</code> 키가 필요한 Supabase Admin API를 통해 구현해야 합니다.
          Supabase Edge Function 또는 별도 API 서버를 통해 <code>supabase.auth.admin.createUser()</code>를 호출하세요.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr auto', gap: '0.75rem', alignItems: 'end', opacity: 0.5, pointerEvents: 'none' }}>
          <div>
            <label className="label">이메일</label>
            <input type="email" placeholder="team@example.com" className="input-field" disabled />
          </div>
          <div>
            <label className="label">이름</label>
            <input type="text" placeholder="홍길동" className="input-field" disabled />
          </div>
          <div>
            <label className="label">임시 비밀번호</label>
            <input type="password" placeholder="••••••••" className="input-field" disabled />
          </div>
          <button disabled className="btn-primary" style={{ opacity: 0.5 }}>
            <UserPlus size={14} />
            초대
          </button>
        </div>
      </div>

      {/* 사용자 목록 */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Users size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            전체 팀원
          </h2>
          <span className="badge badge-slate">{profiles?.length ?? 0}명</span>
        </div>

        <table className="table-base">
          <thead>
            <tr>
              <th>이름</th>
              <th>역할</th>
              <th>가입일</th>
              <th style={{ width: '120px' }}>역할 변경</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((profile) => (
              <tr key={profile.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <div
                      style={{
                        width: '2rem',
                        height: '2rem',
                        borderRadius: '50%',
                        background: profile.role === 'admin'
                          ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                          : 'linear-gradient(135deg, #6366f1, #818cf8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'white',
                        flexShrink: 0,
                      }}
                    >
                      {profile.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </div>
                    <span style={{ fontWeight: 500 }}>{profile.name || '-'}</span>
                  </div>
                </td>
                <td>
                  <span
                    className={`badge ${profile.role === 'admin' ? 'badge-indigo' : 'badge-slate'}`}
                    style={
                      profile.role === 'admin'
                        ? { backgroundColor: '#fef2f2', color: '#dc2626' }
                        : undefined
                    }
                  >
                    {profile.role}
                  </span>
                </td>
                <td>
                  <span style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                    {new Date(profile.created_at).toLocaleDateString('ko-KR')}
                  </span>
                </td>
                <td>
                  <RoleToggle
                    userId={profile.id}
                    currentRole={profile.role}
                    isSelf={profile.id === user.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
