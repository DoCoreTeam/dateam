'use client'

import useSWRInfinite from 'swr/infinite'
import { useRef, useEffect } from 'react'
import Link from 'next/link'
import { Users, Plus, Mail, Phone, Loader2 } from 'lucide-react'
import type { Contact, Account } from '@/types/database'

type ContactWithAccount = Contact & { accounts: Pick<Account, 'name'> | null }
type PageData = { items: ContactWithAccount[]; nextCursor: string | null; hasMore: boolean }

const PAGE_SIZE = 20

function getKey(pageIndex: number, prev: PageData | null) {
  if (pageIndex > 0 && !prev?.nextCursor) return null
  const cursor = prev?.nextCursor ? `&cursor=${encodeURIComponent(prev.nextCursor)}` : ''
  return `/api/contacts?limit=${PAGE_SIZE}${cursor}`
}

export default function ContactsPage() {
  const { data, size, setSize, isLoading, isValidating } = useSWRInfinite<PageData>(getKey)

  const contacts = data?.flatMap((p) => p.items) ?? []
  const hasMore = data?.[data.length - 1]?.hasMore ?? false

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isValidating) setSize(size + 1)
      },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, isValidating, size, setSize])

  return (
    <div>
      <div style={{ marginBottom: '1.75rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>담당자</h1>
          <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>거래처 담당자 연락처 관리</p>
        </div>
        <Link href="/contacts/new" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', minHeight: '44px' }}>
          <Plus size={16} /> 담당자 추가
        </Link>
      </div>

      <div className="card">
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 담당자</h2>
          <span className="badge badge-slate">{contacts.length}명</span>
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
            <Loader2 size={24} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : contacts.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem', textAlign: 'center' }}>
            <Users size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0 }}>등록된 담당자가 없습니다</p>
          </div>
        ) : (
          <table className="table-base table-card">
            <thead>
              <tr>
                <th>담당자</th>
                <th>직책/부서</th>
                <th>연락처</th>
                <th>거래처</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
                      <div>
                        <Link href={`/contacts/${c.id}`} style={{ fontWeight: 600, color: '#0f172a', textDecoration: 'none' }}>{c.name}</Link>
                        {c.accounts?.name && (
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.125rem' }}>{c.accounts.name}</div>
                        )}
                      </div>
                      {c.title && <span className="badge badge-slate" style={{ fontSize: '0.7rem', flexShrink: 0 }}>{c.title}</span>}
                    </div>
                  </td>
                  <td data-label="직책">
                    <div>
                      {c.title && <div style={{ fontSize: '0.875rem', color: '#374151' }}>{c.title}</div>}
                      {c.department && <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{c.department}</div>}
                    </div>
                  </td>
                  <td data-label="연락처">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {c.email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <Mail size={12} color="#94a3b8" />
                          <a href={`mailto:${c.email}`} style={{ fontSize: '0.8125rem', color: '#6366f1', textDecoration: 'none' }}>{c.email}</a>
                        </div>
                      )}
                      {(c.mobile ?? c.phone) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <Phone size={12} color="#94a3b8" />
                          <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{c.mobile ?? c.phone}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td data-label="거래처">
                    {c.accounts?.name ? (
                      <Link href={`/accounts/${c.account_id}`} style={{ fontSize: '0.875rem', color: '#6366f1', textDecoration: 'none' }}>
                        {c.accounts.name}
                      </Link>
                    ) : <span style={{ color: '#cbd5e1', fontSize: '0.8125rem' }}>-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div ref={sentinelRef} style={{ height: 1 }} />
        {isValidating && !isLoading && (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#94a3b8' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}
      </div>
    </div>
  )
}
