'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import Link from 'next/link'
import { Briefcase, Plus, Loader2, Search, X, Globe, Phone, MapPin, ExternalLink, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { Account } from '@/types/database'
import AccountActions from './AccountActions'
import SlidePanel from '@/components/ui/SlidePanel'
import { useDebounce } from '@/hooks/useDebounce'

type PageData = { items: Account[]; nextCursor: string | null; hasMore: boolean; capped?: boolean }
type SortField = 'created_at' | 'name' | 'fit_score' | 'industry' | 'region'

const SEGMENTS = ['엔터프라이즈', 'SMB', '공공', '스타트업'] as const

function fitColor(score: number | null) {
  if (score === null) return { color: '#94a3b8', background: '#f8fafc' }
  if (score >= 70) return { color: '#16a34a', background: '#f0fdf4' }
  if (score >= 40) return { color: '#d97706', background: '#fffbeb' }
  return { color: '#dc2626', background: '#fef2f2' }
}

function SortIcon({ field, sort, dir }: { field: SortField; sort: SortField; dir: 'asc' | 'desc' }) {
  if (sort !== field) return <ChevronsUpDown size={12} className="sort-icon" />
  return dir === 'asc'
    ? <ChevronUp size={12} className="sort-icon" />
    : <ChevronDown size={12} className="sort-icon" />
}

export default function AccountsPage() {
  const [search, setSearch] = useState('')
  const [filterSegment, setFilterSegment] = useState('')
  const [sort, setSort] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<Account | null>(null)

  const debouncedSearch = useDebounce(search, 300)

  const getKey = useCallback((pageIndex: number, prev: PageData | null) => {
    if (pageIndex > 0 && !prev?.nextCursor) return null
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (filterSegment)   params.set('segment', filterSegment)
    if (sort !== 'created_at') params.set('sort', sort)
    if (sortDir !== 'desc') params.set('dir', sortDir)
    if (prev?.nextCursor) params.set('cursor', prev.nextCursor)
    const qs = params.toString()
    return `/api/accounts${qs ? `?${qs}` : ''}`
  }, [debouncedSearch, filterSegment, sort, sortDir])

  const { data, size, setSize, isLoading, isValidating } = useSWRInfinite<PageData>(getKey)

  // 필터 변경 시 페이지 리셋
  useEffect(() => { setSize(1) }, [debouncedSearch, filterSegment, sort, sortDir, setSize])

  const accounts = data?.flatMap((p) => p.items) ?? []
  const hasMore = data?.[data.length - 1]?.hasMore ?? false
  const isCapped = data?.[data.length - 1]?.capped ?? false
  const hasFilters = debouncedSearch || filterSegment || sort !== 'created_at'

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

  function clearFilters() {
    setSearch('')
    setFilterSegment('')
    setSort('created_at')
    setSortDir('desc')
  }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>거래처</h1>
          <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>고객사 및 잠재 거래처 관리</p>
        </div>
        <Link href="/accounts/new" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', minHeight: '44px' }}>
          <Plus size={16} /> 거래처 추가
        </Link>
      </div>

      <div className="card">
        {/* 헤더 */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Briefcase size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 거래처</h2>
          <span className="badge badge-slate">{accounts.length}{hasFilters ? '건 (필터됨)' : '개'}</span>
        </div>

        {/* 필터 바 */}
        <div className="filter-bar">
          <div className="filter-search-wrap">
            <Search size={14} />
            <input
              className="filter-search"
              placeholder="거래처명 검색…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="filter-select" value={filterSegment} onChange={e => setFilterSegment(e.target.value)}>
            <option value="">세그먼트 전체</option>
            {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(search || filterSegment || sort !== 'created_at') && (
            <button className="filter-clear" onClick={clearFilters}>
              <X size={13} /> 초기화
            </button>
          )}
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
            <Loader2 size={24} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : accounts.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem', textAlign: 'center' }}>
            <Briefcase size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0 }}>{hasFilters ? '검색 결과가 없습니다' : '등록된 거래처가 없습니다'}</p>
            {!hasFilters && (
              <Link href="/accounts/new" style={{ marginTop: '1rem', display: 'inline-block', color: '#6366f1', fontSize: '0.875rem', fontWeight: 600 }}>
                첫 거래처 추가하기 →
              </Link>
            )}
          </div>
        ) : (
          <table className="table-base table-card">
            <thead>
              <tr>
                <th className={`sort-th${sort === 'name' ? ' active' : ''}`} onClick={() => handleSort('name')}>
                  거래처명 <SortIcon field="name" sort={sort} dir={sortDir} />
                </th>
                <th className={`sort-th${sort === 'industry' ? ' active' : ''}`} onClick={() => handleSort('industry')}>
                  업종 <SortIcon field="industry" sort={sort} dir={sortDir} />
                </th>
                <th>세그먼트</th>
                <th className={`sort-th${sort === 'region' ? ' active' : ''}`} onClick={() => handleSort('region')}>
                  지역 <SortIcon field="region" sort={sort} dir={sortDir} />
                </th>
                <th className={`sort-th${sort === 'fit_score' ? ' active' : ''}`} style={{ textAlign: 'center' }} onClick={() => handleSort('fit_score')}>
                  Fit <SortIcon field="fit_score" sort={sort} dir={sortDir} />
                </th>
                <th style={{ width: '80px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => {
                const fc = fitColor(acc.fit_score)
                return (
                  <tr key={acc.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(acc)}>
                    <td className="card-header" onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
                        <div>
                          <button
                            onClick={() => setSelected(acc)}
                            style={{ fontWeight: 600, color: '#0f172a', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9375rem', padding: 0, textAlign: 'left' }}
                          >
                            {acc.name}
                          </button>
                          {acc.industry && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.125rem' }}>{acc.industry}</div>}
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
                      {acc.segment
                        ? <span className="badge badge-indigo" style={{ fontSize: '0.75rem' }}>{acc.segment}</span>
                        : <span style={{ color: '#cbd5e1' }}>-</span>}
                    </td>
                    <td data-label="지역"><span style={{ color: '#64748b', fontSize: '0.8125rem' }}>{acc.region ?? '-'}</span></td>
                    <td data-label="Fit" style={{ textAlign: 'center' }}>
                      {acc.fit_score !== null
                        ? <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', ...fc }}>{acc.fit_score}</span>
                        : <span style={{ color: '#cbd5e1' }}>-</span>}
                    </td>
                    <td data-label="관리" onClick={e => e.stopPropagation()}>
                      <AccountActions accountId={acc.id} />
                    </td>
                  </tr>
                )
              })}
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

      {/* 슬라이드 패널 */}
      <SlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && <AccountDetail account={selected} onClose={() => setSelected(null)} />}
      </SlidePanel>
    </div>
  )
}

function AccountDetail({ account, onClose }: { account: Account; onClose: () => void }) {
  const fc = fitColor(account.fit_score)
  return (
    <div>
      {/* 배지 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
        {account.industry && <span className="badge badge-slate">{account.industry}</span>}
        {account.segment  && <span className="badge badge-indigo">{account.segment}</span>}
        {account.size     && <span className="badge" style={{ background: '#f8fafc', color: '#64748b' }}>{account.size}</span>}
        {account.fit_score !== null && (
          <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.625rem', borderRadius: '9999px', ...fc }}>
            Fit {account.fit_score}점
          </span>
        )}
      </div>

      {/* 기본 정보 */}
      <div className="detail-info-list">
        {account.website && (
          <div className="detail-info-row">
            <Globe size={14} color="#6366f1" style={{ flexShrink: 0, marginTop: '2px' }} />
            <a href={account.website} target="_blank" rel="noopener noreferrer"
              style={{ color: '#6366f1', wordBreak: 'break-all', fontSize: '0.875rem' }}>
              {account.website}
            </a>
          </div>
        )}
        {account.phone && (
          <div className="detail-info-row">
            <Phone size={14} color="#6366f1" style={{ flexShrink: 0 }} />
            <span>{account.phone}</span>
          </div>
        )}
        {(account.region || account.address) && (
          <div className="detail-info-row">
            <MapPin size={14} color="#6366f1" style={{ flexShrink: 0 }} />
            <span>{[account.region, account.address].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        {account.description && (
          <p style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.6, margin: '0.25rem 0 0' }}>
            {account.description}
          </p>
        )}
        {account.tags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.25rem' }}>
            {account.tags.map(tag => (
              <span key={tag} className="badge" style={{ background: '#f0f9ff', color: '#0284c7', fontSize: '0.75rem' }}>#{tag}</span>
            ))}
          </div>
        )}
      </div>

      <div className="detail-actions">
        <Link href={`/accounts/${account.id}`} className="detail-btn-primary" onClick={onClose}>
          <ExternalLink size={14} /> 전체 보기
        </Link>
        <Link href={`/accounts/${account.id}/edit`} className="detail-btn-ghost" onClick={onClose}>
          편집
        </Link>
      </div>
    </div>
  )
}
