import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Users, UserPlus } from 'lucide-react'
import RoleToggle from './RoleToggle'
import InviteForm from './InviteForm'
import DeleteUserButton from './DeleteUserButton'
import ResetPasswordButton from './ResetPasswordButton'
import type { Profile } from '@/types/database'

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: true }) as unknown as { data: Profile[] | null; error: unknown }

  // 이메일 조회 (auth.users)
  const { data: authUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  const emailMap = new Map(authUsers?.users?.map(u => [u.id, u.email ?? '']) ?? [])

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          사용자 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          팀원 계정 생성 및 역할 관리
        </p>
      </div>

      {/* 새 팀원 초대 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <UserPlus size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            새 팀원 초대
          </h2>
        </div>
        <InviteForm />
      </div>

      {/* 사용자 목록 */}
      <div className="card">
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 팀원</h2>
          <span className="badge badge-slate">{profiles?.length ?? 0}명</span>
        </div>

        <table className="table-base table-card">
          <thead>
            <tr>
              <th>이름</th>
              <th>역할</th>
              <th>초기PW변경</th>
              <th>가입일</th>
              <th style={{ width: '120px' }}>역할 변경</th>
              <th style={{ width: '110px' }}>PW초기화</th>
              <th style={{ width: '100px' }}>삭제</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((profile) => {
              const email = emailMap.get(profile.id) ?? ''
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
                  <td data-label="역할 변경">
                    <RoleToggle userId={profile.id} currentRole={profile.role} isSelf={profile.id === user.id} />
                  </td>
                  <td data-label="PW초기화">
                    <ResetPasswordButton
                      userId={profile.id}
                      userEmail={email}
                      userName={profile.name ?? '-'}
                    />
                  </td>
                  <td data-label="삭제">
                    <DeleteUserButton userId={profile.id} userName={profile.name ?? profile.id} isSelf={profile.id === user.id} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
