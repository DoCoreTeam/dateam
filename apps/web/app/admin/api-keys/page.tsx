import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'
import RevokeKeyButton from './RevokeKeyButton'

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

export default async function AdminApiKeysPage() {
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

  const { data: keys } = await adminClient
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false }) as unknown as { data: ApiKey[] | null }

  // 사용자 이메일/이름 조회
  const { data: authUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  const emailMap = new Map(authUsers?.users?.map(u => [u.id, u.email ?? '']) ?? [])

  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, name') as unknown as { data: Pick<Profile, 'id' | 'name'>[] | null }
  const nameMap = new Map((profiles ?? []).map(p => [p.id, p.name]))

  const activeKeys = (keys ?? []).filter(k => !k.revoked_at)
  const revokedKeys = (keys ?? []).filter(k => k.revoked_at)

  function fmt(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          API 키 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          전체 발급된 API 키 목록 및 관리
        </p>
      </div>

      {/* Active keys */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>활성 키</h2>
          <span className="badge badge-slate" style={{ background: '#f0fdf4', color: '#16a34a' }}>{activeKeys.length}개</span>
        </div>

        {activeKeys.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>활성 API 키가 없습니다</div>
        ) : (
          <table className="table-base table-card">
            <thead>
              <tr>
                <th>이름</th>
                <th>사용자</th>
                <th>마스킹 키</th>
                <th>요청 수</th>
                <th>마지막 사용</th>
                <th>생성일</th>
                <th>폐기</th>
              </tr>
            </thead>
            <tbody>
              {activeKeys.map(k => (
                <tr key={k.id}>
                  <td className="card-header">
                    <div style={{ fontWeight: 600 }}>{k.name}</div>
                  </td>
                  <td data-label="사용자">
                    <div>
                      <div style={{ fontSize: 13 }}>{nameMap.get(k.user_id) ?? '—'}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{emailMap.get(k.user_id) ?? k.user_id.slice(0, 8)}</div>
                    </div>
                  </td>
                  <td data-label="마스킹 키">
                    <code style={{ fontSize: 12, color: '#64748b' }}>{maskKey(k.key_prefix)}</code>
                  </td>
                  <td data-label="요청 수">
                    <span style={{ fontSize: 13 }}>{k.request_count.toLocaleString()}회</span>
                  </td>
                  <td data-label="마지막 사용">
                    <span style={{ fontSize: 13, color: '#64748b' }}>{fmt(k.last_used_at)}</span>
                  </td>
                  <td data-label="생성일">
                    <span style={{ fontSize: 13, color: '#64748b' }}>{fmt(k.created_at)}</span>
                  </td>
                  <td data-label="폐기">
                    <RevokeKeyButton keyId={k.id} keyName={k.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Revoked keys */}
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
    </div>
  )
}
