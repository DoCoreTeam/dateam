import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Briefcase, Plus } from 'lucide-react'
import type { Account } from '@/types/database'
import AccountActions from './AccountActions'

function fitColor(score: number | null) {
  if (score === null) return { color: '#94a3b8', background: '#f8fafc' }
  if (score >= 70) return { color: '#16a34a', background: '#f0fdf4' }
  if (score >= 40) return { color: '#d97706', background: '#fffbeb' }
  return { color: '#dc2626', background: '#fef2f2' }
}

export default async function AccountsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any
  const { data: accounts } = await adm
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false }) as { data: Account[] | null }

  const list = accounts ?? []

  return (
    <div>
      <div style={{ marginBottom: '1.75rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
            거래처
          </h1>
          <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
            고객사 및 잠재 거래처 관리
          </p>
        </div>
        <Link href="/accounts/new" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', minHeight: '44px' }}>
          <Plus size={16} />
          거래처 추가
        </Link>
      </div>

      <div className="card">
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Briefcase size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 거래처</h2>
          <span className="badge badge-slate">{list.length}개</span>
        </div>

        {list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
            <Briefcase size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0 }}>등록된 거래처가 없습니다</p>
            <Link href="/accounts/new" style={{ marginTop: '1rem', display: 'inline-block', color: '#6366f1', fontSize: '0.875rem', fontWeight: 600 }}>
              첫 거래처 추가하기 →
            </Link>
          </div>
        ) : (
          <table className="table-base table-card">
            <thead>
              <tr>
                <th>거래처명</th>
                <th>업종</th>
                <th>세그먼트</th>
                <th>지역</th>
                <th style={{ textAlign: 'center' }}>Fit</th>
                <th style={{ width: '80px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {list.map((acc) => {
                const fc = fitColor(acc.fit_score)
                return (
                  <tr key={acc.id}>
                    <td className="card-header">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
                        <div>
                          <Link href={`/accounts/${acc.id}`} style={{ fontWeight: 600, color: '#0f172a', textDecoration: 'none', fontSize: '0.9375rem' }}>
                            {acc.name}
                          </Link>
                          {acc.industry && (
                            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.125rem' }}>{acc.industry}</div>
                          )}
                        </div>
                        {acc.fit_score !== null && (
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '9999px', ...fc, flexShrink: 0 }}>
                            Fit {acc.fit_score}
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label="업종"><span style={{ color: '#374151' }}>{acc.industry ?? '-'}</span></td>
                    <td data-label="세그먼트">
                      {acc.segment ? (
                        <span className="badge badge-indigo" style={{ fontSize: '0.75rem' }}>{acc.segment}</span>
                      ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                    </td>
                    <td data-label="지역"><span style={{ color: '#64748b', fontSize: '0.8125rem' }}>{acc.region ?? '-'}</span></td>
                    <td data-label="Fit" style={{ textAlign: 'center' }}>
                      {acc.fit_score !== null ? (
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', ...fc }}>
                          {acc.fit_score}
                        </span>
                      ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                    </td>
                    <td data-label="관리">
                      <AccountActions accountId={acc.id} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
