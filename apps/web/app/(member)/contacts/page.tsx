'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import Link from 'next/link'
import { Users, Plus, Mail, Phone, Loader2, Search, X, ExternalLink, Briefcase, ChevronUp, ChevronDown, ChevronsUpDown, Sparkles } from 'lucide-react'
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

  const { data, size, setSize, isLoading, isValidating, mutate } = useSWRInfinite<PageData>(getKey)

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
      <div style={{ marginBottom: '1.75rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>담당자</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>거래처 담당자 연락처 관리</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link href="/lead-intake?target=contact" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', minHeight: '44px' }}>
            <Sparkles size={16} /> AI로 추가
          </Link>
          <Link href="/contacts/new?mode=manual" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', minHeight: '44px', border: 'var(--border-w-2) solid var(--border-color)', color: 'var(--text-muted)', background: '#fff', fontSize: 'var(--fs-base)', fontWeight: 600 }}>
            <Plus size={16} /> 수동 입력
          </Link>
        </div>
      </div>

      <div className="card">
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Users size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>전체 담당자</h2>
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
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-12) var(--space-4)' }}>
            <Loader2 size={24} style={{ color: 'var(--brand)', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : contacts.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--space-12) var(--space-4)', color: 'var(--text-faint)', fontSize: 'var(--fs-base)', textAlign: 'center' }}>
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 'var(--space-2)' }}>
                      <div>
                        <button
                          onClick={() => setSelected(c)}
                          style={{ fontWeight: 600, color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-md)', padding: 0, textAlign: 'left' }}
                        >
                          {c.name}
                        </button>
                        {c.accounts?.name && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{c.accounts.name}</div>}
                      </div>
                      {c.title && <span className="badge badge-slate" style={{ fontSize: '0.7rem', flexShrink: 0 }}>{c.title}</span>}
                    </div>
                  </td>
                  <td data-label="직책">
                    <div>
                      {c.title && <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text)' }}>{c.title}</div>}
                      {c.department && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{c.department}</div>}
                    </div>
                  </td>
                  <td data-label="연락처">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      {c.email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <Mail size={12} color="var(--text-faint)" />
                          <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} style={{ fontSize: 'var(--fs-sm)', color: 'var(--brand)', textDecoration: 'none' }}>{c.email}</a>
                        </div>
                      )}
                      {(c.mobile ?? c.phone) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <Phone size={12} color="var(--text-faint)" />
                          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{c.mobile ?? c.phone}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td data-label="역할">
                    {c.role
                      ? <span className="badge badge-slate" style={{ fontSize: 'var(--fs-xs)' }}>{c.role}</span>
                      : <span style={{ color: 'var(--border-subtle)', fontSize: 'var(--fs-sm)' }}>-</span>}
                  </td>
                  <td data-label="거래처" onClick={e => e.stopPropagation()}>
                    {c.accounts?.name ? (
                      <Link href={`/accounts/${c.account_id}`} style={{ fontSize: 'var(--fs-base)', color: 'var(--brand)', textDecoration: 'none' }}>
                        {c.accounts.name}
                      </Link>
                    ) : <span style={{ color: 'var(--border-subtle)', fontSize: 'var(--fs-sm)' }}>-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div ref={sentinelRef} style={{ height: 1 }} />
        {isValidating && !isLoading && (
          <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--text-faint)' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        {isCapped && (
          <div style={{ textAlign: 'center', padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--warning)', background: 'var(--warning-bg)', borderTop: 'var(--hairline) solid var(--warning-border)' }}>
            결과가 500건을 초과합니다. 검색 조건을 좁혀주세요.
          </div>
        )}
      </div>

      <SlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && <ContactDetail contact={selected} onClose={() => setSelected(null)} onDeleted={() => { mutate(); setSelected(null) }} />}
      </SlidePanel>
    </div>
  )
}

function ContactDetail({ contact: c, onClose, onDeleted }: { contact: ContactWithAccount; onClose: () => void; onDeleted: () => void }) {
  async function handleDelete() {
    if (!confirm(`담당자 "${c.name}"을(를) 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/contacts/${c.id}`, { method: 'DELETE' })
    if (res.ok) onDeleted()
    else alert('삭제에 실패했습니다')
  }
  return (
    <div>
      {/* 직책/부서 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
        {c.title     && <span className="badge badge-slate">{c.title}</span>}
        {c.department && <span className="badge" style={{ background: 'var(--color-bg)', color: 'var(--text-muted)' }}>{c.department}</span>}
      </div>

      <div className="detail-info-list">
        {c.accounts?.name && (
          <div className="detail-info-row">
            <Briefcase size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <Link href={`/accounts/${c.account_id}`} onClick={onClose} style={{ color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
              {c.accounts.name}
            </Link>
          </div>
        )}
        {c.email && (
          <div className="detail-info-row">
            <Mail size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <a href={`mailto:${c.email}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>{c.email}</a>
          </div>
        )}
        {c.mobile && (
          <div className="detail-info-row">
            <Phone size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <span>📱 {c.mobile}</span>
          </div>
        )}
        {c.phone && (
          <div className="detail-info-row">
            <Phone size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <span>{c.phone}</span>
          </div>
        )}
        {c.notes && (
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', lineHeight: 1.6, margin: '0.5rem 0 0' }}>
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
        <button onClick={handleDelete} className="detail-btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--danger-border)', cursor: 'pointer' }}>
          삭제
        </button>
      </div>
    </div>
  )
}
