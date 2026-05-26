'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import Link from 'next/link'
import { Users, Plus, Mail, Phone, Loader2, Search, X, ExternalLink, Briefcase, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { Contact, Account } from '@/types/database'
import SlidePanel from '@/components/ui/SlidePanel'
import { useDebounce } from '@/hooks/useDebounce'

type ContactWithAccount = Contact & { accounts: Pick<Account, 'id' | 'name'> | null }
type PageData = { items: ContactWithAccount[]; nextCursor: string | null; hasMore: boolean; capped?: boolean }
type SortField = 'created_at' | 'name' | 'title' | 'department'

function SortIcon({ field, sort, dir }: { field: SortField; sort: SortField; dir: 'asc' | 'desc' }) {
  if (sort !== field) return <ChevronsUpDown size={12} className="sort-icon" />
  return dir === 'asc'
    ? <ChevronUp size={12} className="sort-icon" />
    : <ChevronDown size={12} className="sort-icon" />
}

export default function ContactsPage() {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<ContactWithAccount | null>(null)

  const debouncedSearch = useDebounce(search, 300)

  const getKey = useCallback((pageIndex: number, prev: PageData | null) => {
    if (pageIndex > 0 && !prev?.nextCursor) return null
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (sort !== 'created_at') params.set('sort', sort)
    if (sortDir !== 'desc') params.set('dir', sortDir)
    if (prev?.nextCursor) params.set('cursor', prev.nextCursor)
    const qs = params.toString()
    return `/api/contacts${qs ? `?${qs}` : ''}`
  }, [debouncedSearch, sort, sortDir])

  const { data, size, setSize, isLoading, isValidating } = useSWRInfinite<PageData>(getKey)

  useEffect(() => { setSize(1) }, [debouncedSearch, sort, sortDir, setSize])

  const contacts = data?.flatMap((p) => p.items) ?? []
  const hasMore = data?.[data.length - 1]?.hasMore ?? false
  const isCapped = data?.[data.length - 1]?.capped ?? false
  const hasFilters = debouncedSearch || sort !== 'created_at'

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasMore && !isValidating) setSize(s => s + 1) },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, isValidating, setSize])

  function handleSort(field: SortField) {
    if (sort === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(field); setSortDir('asc') }
  }

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
          <span className="badge badge-slate">{contacts.length}{hasFilters ? '명 (필터됨)' : '명'}</span>
        </div>

        {/* 필터 바 */}
        <div className="filter-bar">
          <div className="filter-search-wrap">
            <Search size={14} />
            <input
              className="filter-search"
              placeholder="이름 또는 이메일 검색…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {(search || sort !== 'created_at') && (
            <button className="filter-clear" onClick={() => { setSearch(''); setSort('created_at'); setSortDir('desc') }}>
              <X size={13} /> 초기화
            </button>
          )}
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
            <Loader2 size={24} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : contacts.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem', textAlign: 'center' }}>
            <Users size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0 }}>{hasFilters ? '검색 결과가 없습니다' : '등록된 담당자가 없습니다'}</p>
          </div>
        ) : (
          <table className="table-base table-card">
            <thead>
              <tr>
                <th className={`sort-th${sort === 'name' ? ' active' : ''}`} onClick={() => handleSort('name')}>
                  담당자 <SortIcon field="name" sort={sort} dir={sortDir} />
                </th>
                <th className={`sort-th${sort === 'title' ? ' active' : ''}`} onClick={() => handleSort('title')}>
                  직책/부서 <SortIcon field="title" sort={sort} dir={sortDir} />
                </th>
                <th>연락처</th>
                <th>역할</th>
                <th>거래처</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(c)}>
                  <td className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
                      <div>
                        <button
                          onClick={() => setSelected(c)}
                          style={{ fontWeight: 600, color: '#0f172a', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9375rem', padding: 0, textAlign: 'left' }}
                        >
                          {c.name}
                        </button>
                        {c.accounts?.name && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.125rem' }}>{c.accounts.name}</div>}
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
                          <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} style={{ fontSize: '0.8125rem', color: '#6366f1', textDecoration: 'none' }}>{c.email}</a>
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
                  <td data-label="역할">
                    {c.role
                      ? <span className="badge badge-slate" style={{ fontSize: '0.75rem' }}>{c.role}</span>
                      : <span style={{ color: '#cbd5e1', fontSize: '0.8125rem' }}>-</span>}
                  </td>
                  <td data-label="거래처" onClick={e => e.stopPropagation()}>
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
        {isCapped && (
          <div style={{ textAlign: 'center', padding: '0.75rem 1rem', fontSize: '0.8125rem', color: '#92400e', background: '#fffbeb', borderTop: '1px solid #fde68a' }}>
            결과가 500건을 초과합니다. 검색 조건을 좁혀주세요.
          </div>
        )}
      </div>

      <SlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && <ContactDetail contact={selected} onClose={() => setSelected(null)} />}
      </SlidePanel>
    </div>
  )
}

function ContactDetail({ contact: c, onClose }: { contact: ContactWithAccount; onClose: () => void }) {
  return (
    <div>
      {/* 직책/부서 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
        {c.title     && <span className="badge badge-slate">{c.title}</span>}
        {c.department && <span className="badge" style={{ background: '#f8fafc', color: '#64748b' }}>{c.department}</span>}
      </div>

      <div className="detail-info-list">
        {c.accounts?.name && (
          <div className="detail-info-row">
            <Briefcase size={14} color="#6366f1" style={{ flexShrink: 0 }} />
            <Link href={`/accounts/${c.account_id}`} onClick={onClose} style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
              {c.accounts.name}
            </Link>
          </div>
        )}
        {c.email && (
          <div className="detail-info-row">
            <Mail size={14} color="#6366f1" style={{ flexShrink: 0 }} />
            <a href={`mailto:${c.email}`} style={{ color: '#6366f1', textDecoration: 'none' }}>{c.email}</a>
          </div>
        )}
        {c.mobile && (
          <div className="detail-info-row">
            <Phone size={14} color="#6366f1" style={{ flexShrink: 0 }} />
            <span>📱 {c.mobile}</span>
          </div>
        )}
        {c.phone && (
          <div className="detail-info-row">
            <Phone size={14} color="#6366f1" style={{ flexShrink: 0 }} />
            <span>{c.phone}</span>
          </div>
        )}
        {c.notes && (
          <p style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.6, margin: '0.5rem 0 0' }}>
            {c.notes}
          </p>
        )}
      </div>

      <div className="detail-actions">
        <Link href={`/contacts/${c.id}`} className="detail-btn-primary" onClick={onClose}>
          <ExternalLink size={14} /> 전체 보기
        </Link>
        <Link href={`/contacts/${c.id}/edit`} className="detail-btn-ghost" onClick={onClose}>
          편집
        </Link>
      </div>
    </div>
  )
}
