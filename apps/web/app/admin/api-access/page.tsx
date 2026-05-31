import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'
import ApproveRejectButtons from './ApproveRejectButtons'

interface AccessRequest {
  id: string
  email: string
  name: string
  company: string | null
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  notes: string | null
  created_at: string
  approved_at: string | null
  rejected_at: string | null
  temp_password: string | null
}

export default async function AdminApiAccessPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const profileResult = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<Profile, 'role'> | null }

  if (profileResult.data?.role !== 'admin') redirect('/home')

  const { data: requests } = await adminClient
    .from('api_access_requests')
    .select('*')
    .order('created_at', { ascending: false }) as unknown as { data: AccessRequest[] | null }

  const pending = (requests ?? []).filter(r => r.status === 'pending')
  const processed = (requests ?? []).filter(r => r.status !== 'pending')

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          API 접근 신청 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          외부 사용자의 API 접근 신청을 승인하거나 거절합니다
        </p>
      </div>

      {/* Pending */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>대기 중</h2>
          <span className="badge badge-slate" style={{ background: '#fef3c7', color: '#d97706' }}>{pending.length}건</span>
        </div>

        {pending.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>대기 중인 신청이 없습니다</div>
        ) : (
          <table className="table-base table-card">
            <thead>
              <tr>
                <th>신청자</th>
                <th>회사</th>
                <th>활용 목적</th>
                <th>신청일</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(req => (
                <tr key={req.id}>
                  <td className="card-header">
                    <div>
                      <div style={{ fontWeight: 600 }}>{req.name}</div>
                      <div style={{ fontSize: 13, color: '#64748b' }}>{req.email}</div>
                    </div>
                  </td>
                  <td data-label="회사">{req.company ?? '—'}</td>
                  <td data-label="활용 목적" style={{ maxWidth: 280 }}>
                    <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {req.reason}
                    </div>
                  </td>
                  <td data-label="신청일">
                    <span style={{ color: '#64748b', fontSize: 13 }}>
                      {new Date(req.created_at).toLocaleDateString('ko-KR')}
                    </span>
                  </td>
                  <td data-label="처리">
                    <ApproveRejectButtons requestId={req.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Processed */}
      {processed.length > 0 && (
        <div className="card">
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>처리 완료</h2>
          </div>
          <table className="table-base table-card">
            <thead>
              <tr>
                <th>신청자</th>
                <th>회사</th>
                <th>상태</th>
                <th>처리일</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {processed.map(req => (
                <tr key={req.id}>
                  <td className="card-header">
                    <div>
                      <div style={{ fontWeight: 600 }}>{req.name}</div>
                      <div style={{ fontSize: 13, color: '#64748b' }}>{req.email}</div>
                    </div>
                  </td>
                  <td data-label="회사">{req.company ?? '—'}</td>
                  <td data-label="상태">
                    <span className={`badge ${req.status === 'approved' ? 'badge-indigo' : 'badge-slate'}`}
                      style={req.status === 'approved' ? { background: '#f0fdf4', color: '#16a34a' } : { background: '#fef2f2', color: '#dc2626' }}>
                      {req.status === 'approved' ? '승인' : '거절'}
                    </span>
                  </td>
                  <td data-label="처리일">
                    <span style={{ color: '#64748b', fontSize: 13 }}>
                      {new Date(req.approved_at ?? req.rejected_at ?? req.created_at).toLocaleDateString('ko-KR')}
                    </span>
                  </td>
                  <td data-label="비고">
                    <span style={{ fontSize: 13, color: '#64748b' }}>{req.notes ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
