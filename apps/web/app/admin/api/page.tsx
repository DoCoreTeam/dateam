import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'
import ApproveRejectButtons from '../api-access/ApproveRejectButtons'
import RevokeKeyButton from '../api-keys/RevokeKeyButton'

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

interface ApiKey {
  id: string
  user_id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  request_count: number
  rate_limit_per_minute: number
}

function maskKey(prefix: string): string {
  return `${prefix}${'•'.repeat(20)}`
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default async function AdminApiPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
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

  const params = await searchParams
  const tab = params.tab === 'keys' ? 'keys' : 'access'

  // 탭에 따라 필요한 데이터만 fetch
  const [accessRes, keysRes, authUsersRes, profilesRes] = await Promise.all([
    (adminClient as unknown as { from: (t: string) => { select: (s: string) => { order: (f: string, o: object) => Promise<{ data: AccessRequest[] | null }> } } })
      .from('api_access_requests').select('*').order('created_at', { ascending: false }),
    (adminClient as unknown as { from: (t: string) => { select: (s: string) => { order: (f: string, o: object) => Promise<{ data: ApiKey[] | null }> } } })
      .from('api_keys').select('*').order('created_at', { ascending: false }),
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
    (adminClient as unknown as { from: (t: string) => { select: (s: string) => Promise<{ data: Pick<Profile, 'id' | 'name'>[] | null }> } })
      .from('profiles').select('id, name'),
  ])

  const requests = accessRes.data ?? []
  const pending = requests.filter(r => r.status === 'pending')
  const processed = requests.filter(r => r.status !== 'pending')

  const keys = keysRes.data ?? []
  const emailMap = new Map(authUsersRes.data?.users?.map(u => [u.id, u.email ?? '']) ?? [])
  const nameMap = new Map((profilesRes.data ?? []).map(p => [p.id, p.name]))
  const activeKeys = keys.filter(k => !k.revoked_at)
  const revokedKeys = keys.filter(k => k.revoked_at)

  const tabs = [
    { key: 'access', label: 'API 접근 신청', badge: pending.length > 0 ? pending.length : null },
    { key: 'keys', label: 'API 키 관리', badge: null },
  ]

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          API 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          API 접근 신청 처리 및 키 발급 현황 관리
        </p>
      </div>

      {/* 탭 네비게이션 */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem' }}>
        {tabs.map(t => (
          <a
            key={t.key}
            href={`/admin/api?tab=${t.key}`}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem', fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? '#4f46e5' : '#64748b',
              borderBottom: tab === t.key ? '2px solid #4f46e5' : '2px solid transparent',
              marginBottom: '-2px',
              textDecoration: 'none',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
            {t.badge !== null && (
              <span style={{
                background: '#fef3c7', color: '#d97706',
                fontSize: '0.7rem', fontWeight: 700,
                padding: '0 6px', borderRadius: '999px', lineHeight: '1.5rem',
              }}>
                {t.badge}
              </span>
            )}
          </a>
        ))}
      </div>

      {/* API 접근 신청 탭 */}
      {tab === 'access' && (
        <>
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
                  <tr><th>신청자</th><th>회사</th><th>활용 목적</th><th>신청일</th><th>처리</th></tr>
                </thead>
                <tbody>
                  {pending.map(req => (
                    <tr key={req.id}>
                      <td className="card-header">
                        <div><div style={{ fontWeight: 600 }}>{req.name}</div><div style={{ fontSize: 13, color: '#64748b' }}>{req.email}</div></div>
                      </td>
                      <td data-label="회사">{req.company ?? '—'}</td>
                      <td data-label="활용 목적" style={{ maxWidth: 280 }}>
                        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{req.reason}</div>
                      </td>
                      <td data-label="신청일"><span style={{ color: '#64748b', fontSize: 13 }}>{new Date(req.created_at).toLocaleDateString('ko-KR')}</span></td>
                      <td data-label="처리"><ApproveRejectButtons requestId={req.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {processed.length > 0 && (
            <div className="card">
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>처리 완료</h2>
              </div>
              <table className="table-base table-card">
                <thead>
                  <tr><th>신청자</th><th>회사</th><th>상태</th><th>처리일</th><th>비고</th></tr>
                </thead>
                <tbody>
                  {processed.map(req => (
                    <tr key={req.id}>
                      <td className="card-header">
                        <div><div style={{ fontWeight: 600 }}>{req.name}</div><div style={{ fontSize: 13, color: '#64748b' }}>{req.email}</div></div>
                      </td>
                      <td data-label="회사">{req.company ?? '—'}</td>
                      <td data-label="상태">
                        <span className="badge" style={req.status === 'approved' ? { background: '#f0fdf4', color: '#16a34a' } : { background: '#fef2f2', color: '#dc2626' }}>
                          {req.status === 'approved' ? '승인' : '거절'}
                        </span>
                      </td>
                      <td data-label="처리일"><span style={{ color: '#64748b', fontSize: 13 }}>{new Date(req.approved_at ?? req.rejected_at ?? req.created_at).toLocaleDateString('ko-KR')}</span></td>
                      <td data-label="비고"><span style={{ fontSize: 13, color: '#64748b' }}>{req.notes ?? '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* API 키 관리 탭 */}
      {tab === 'keys' && (
        <>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>활성 키</h2>
              <span className="badge" style={{ background: '#f0fdf4', color: '#16a34a' }}>{activeKeys.length}개</span>
            </div>
            {activeKeys.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>활성 API 키가 없습니다</div>
            ) : (
              <table className="table-base table-card">
                <thead>
                  <tr><th>이름</th><th>사용자</th><th>마스킹 키</th><th>요청 수</th><th>마지막 사용</th><th>생성일</th><th>폐기</th></tr>
                </thead>
                <tbody>
                  {activeKeys.map(k => (
                    <tr key={k.id}>
                      <td className="card-header"><div style={{ fontWeight: 600 }}>{k.name}</div></td>
                      <td data-label="사용자">
                        <div><div style={{ fontSize: 13 }}>{nameMap.get(k.user_id) ?? '—'}</div><div style={{ fontSize: 12, color: '#94a3b8' }}>{emailMap.get(k.user_id) ?? k.user_id.slice(0, 8)}</div></div>
                      </td>
                      <td data-label="마스킹 키"><code style={{ fontSize: 12, color: '#64748b' }}>{maskKey(k.key_prefix)}</code></td>
                      <td data-label="요청 수"><span style={{ fontSize: 13 }}>{k.request_count.toLocaleString()}회</span></td>
                      <td data-label="마지막 사용"><span style={{ fontSize: 13, color: '#64748b' }}>{fmt(k.last_used_at)}</span></td>
                      <td data-label="생성일"><span style={{ fontSize: 13, color: '#64748b' }}>{fmt(k.created_at)}</span></td>
                      <td data-label="폐기"><RevokeKeyButton keyId={k.id} keyName={k.name} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {revokedKeys.length > 0 && (
            <div className="card">
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>폐기된 키 ({revokedKeys.length})</h2>
              </div>
              <table className="table-base table-card">
                <thead>
                  <tr><th>이름</th><th>사용자</th><th>폐기일</th><th>요청 수</th></tr>
                </thead>
                <tbody>
                  {revokedKeys.map(k => (
                    <tr key={k.id} style={{ opacity: 0.6 }}>
                      <td className="card-header"><span style={{ fontWeight: 500 }}>{k.name}</span></td>
                      <td data-label="사용자">{nameMap.get(k.user_id) ?? emailMap.get(k.user_id) ?? '—'}</td>
                      <td data-label="폐기일"><span style={{ fontSize: 13, color: '#64748b' }}>{fmt(k.revoked_at)}</span></td>
                      <td data-label="요청 수"><span style={{ fontSize: 13 }}>{k.request_count.toLocaleString()}회</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
