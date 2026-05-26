import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Briefcase, ArrowLeft, Globe, Phone, MapPin, Users, TrendingUp } from 'lucide-react'
import type { Account, Contact, Deal } from '@/types/database'

interface PageProps { params: Promise<{ id: string }> }

function fitColor(score: number | null) {
  if (score === null) return { color: '#94a3b8', background: '#f8fafc' }
  if (score >= 70) return { color: '#16a34a', background: '#f0fdf4' }
  if (score >= 40) return { color: '#d97706', background: '#fffbeb' }
  return { color: '#dc2626', background: '#fef2f2' }
}

const STAGE_COLOR: Record<string, { color: string; bg: string }> = {
  '신규': { color: '#64748b', bg: '#f8fafc' },
  '검증': { color: '#0891b2', bg: '#ecfeff' },
  '컨택': { color: '#7c3aed', bg: '#f5f3ff' },
  'PoC': { color: '#d97706', bg: '#fffbeb' },
  '제안': { color: '#0284c7', bg: '#f0f9ff' },
  '협상': { color: '#c2410c', bg: '#fff7ed' },
  '수주': { color: '#16a34a', bg: '#f0fdf4' },
  '실패': { color: '#dc2626', bg: '#fef2f2' },
}

export default async function AccountDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const [accountRes, contactsRes, dealsRes] = await Promise.all([
    adm.from('accounts').select('*').eq('id', id).single() as Promise<{ data: Account | null }>,
    adm.from('contacts').select('*').eq('account_id', id).order('created_at') as Promise<{ data: Contact[] | null }>,
    adm.from('deals').select('*').eq('account_id', id).order('created_at', { ascending: false }) as Promise<{ data: Deal[] | null }>,
  ])

  const account: Account | null = accountRes.data
  if (!account) notFound()

  const contacts = contactsRes.data ?? []
  const deals = dealsRes.data ?? []
  const fc = fitColor(account.fit_score)

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/accounts" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: '#6366f1', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', marginBottom: '0.75rem' }}>
          <ArrowLeft size={14} /> 거래처 목록
        </Link>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg, #6366f1, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Briefcase size={18} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>{account.name}</h1>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                {account.industry && <span className="badge badge-slate">{account.industry}</span>}
                {account.segment && <span className="badge badge-indigo">{account.segment}</span>}
                {account.size && <span className="badge" style={{ background: '#f8fafc', color: '#64748b' }}>{account.size}</span>}
                {account.account_type && <span className="badge" style={{ background: '#fff7ed', color: '#c2410c' }}>{account.account_type}</span>}
                {account.gpu_demand_intensity && <span className="badge" style={{ background: '#f0fdf4', color: '#16a34a' }}>GPU {account.gpu_demand_intensity}</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {account.fit_score !== null && (
              <span style={{ fontSize: '0.875rem', fontWeight: 700, padding: '0.375rem 0.875rem', borderRadius: '9999px', ...fc }}>
                Fit {account.fit_score}점
              </span>
            )}
            <Link href={`/accounts/${id}/edit`} className="btn-primary" style={{ textDecoration: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.875rem', minHeight: '44px', display: 'flex', alignItems: 'center' }}>
              편집
            </Link>
          </div>
        </div>
      </div>

      <div className="responsive-grid-2" style={{ gap: '1.25rem', alignItems: 'flex-start' }}>
        {/* 기본 정보 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: '0 0 1rem' }}>기본 정보</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {account.website && (
                <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
                  <Globe size={15} color="#6366f1" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <a href={account.website} target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1', fontSize: '0.875rem', wordBreak: 'break-all' }}>{account.website}</a>
                </div>
              )}
              {account.phone && (
                <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
                  <Phone size={15} color="#6366f1" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '0.875rem', color: '#374151' }}>{account.phone}</span>
                </div>
              )}
              {account.registration_number && (
                <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', minWidth: '5rem' }}>번호</span>
                  <span style={{ fontSize: '0.875rem', color: '#374151' }}>{account.registration_number}</span>
                </div>
              )}
              {account.source && (
                <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', minWidth: '5rem' }}>출처</span>
                  <span style={{ fontSize: '0.875rem', color: '#374151' }}>{account.source}</span>
                </div>
              )}
              {account.region && (
                <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
                  <MapPin size={15} color="#6366f1" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '0.875rem', color: '#374151' }}>{account.region} {account.address && `· ${account.address}`}</span>
                </div>
              )}
              {account.description && (
                <p style={{ fontSize: '0.875rem', color: '#374151', margin: '0.5rem 0 0', lineHeight: 1.6 }}>{account.description}</p>
              )}
              {account.tags?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.25rem' }}>
                  {account.tags.map((tag) => (
                    <span key={tag} className="badge" style={{ background: '#f0f9ff', color: '#0284c7', fontSize: '0.75rem' }}>#{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 담당자 */}
          <div className="card">
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Users size={15} color="#6366f1" />
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>담당자</h2>
                <span className="badge badge-slate">{contacts.length}</span>
              </div>
              <Link href={`/contacts/new?account_id=${id}`} style={{ fontSize: '0.8125rem', color: '#6366f1', fontWeight: 600, textDecoration: 'none' }}>+ 추가</Link>
            </div>
            {contacts.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>담당자가 없습니다</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {contacts.map((c) => (
                  <div key={c.id} style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.875rem' }}>{c.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{[c.title, c.department].filter(Boolean).join(' · ')}</div>
                      {c.email && <div style={{ fontSize: '0.75rem', color: '#6366f1', marginTop: '0.125rem' }}>{c.email}</div>}
                    </div>
                    <Link href={`/contacts/${c.id}`} style={{ fontSize: '0.75rem', color: '#6366f1', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>보기</Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 영업기회 */}
        <div className="card">
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={15} color="#6366f1" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>영업기회</h2>
              <span className="badge badge-slate">{deals.length}</span>
            </div>
            <Link href={`/deals/new?account_id=${id}`} style={{ fontSize: '0.8125rem', color: '#6366f1', fontWeight: 600, textDecoration: 'none' }}>+ 추가</Link>
          </div>
          {deals.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>영업기회가 없습니다</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {deals.map((d) => {
                const sc = STAGE_COLOR[d.stage] ?? STAGE_COLOR['신규']
                return (
                  <div key={d.id} style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <div>
                        <Link href={`/deals/${d.id}`} style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.875rem', textDecoration: 'none' }}>{d.title}</Link>
                        <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.25rem', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: '9999px', color: sc.color, background: sc.bg }}>{d.stage}</span>
                          {d.value && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>₩{d.value.toLocaleString()}</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', flexShrink: 0 }}>{d.probability}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
