'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import Link from 'next/link'
import { TrendingUp, Plus, Loader2, Search, X, ExternalLink, Briefcase, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { Deal, Account } from '@/types/database'
import SlidePanel from '@/components/ui/SlidePanel'
import { useDebounce } from '@/hooks/useDebounce'

type DealWithAccount = Deal & { accounts: Pick<Account, 'id' | 'name'> | null }
type PageData = { items: DealWithAccount[]; nextCursor: string | null; hasMore: boolean; total: number; capped?: boolean }
type SortField = 'created_at' | 'title' | 'stage' | 'value' | 'probability'

const STAGES = ['신규', '검증', '컨택', 'PoC', '제안', '협상', '수주', '실패'] as const
const STAGE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  '신규':  { color: '#64748b', bg: '#f8fafc',  border: '#e2e8f0' },
  '검증':  { color: '#0891b2', bg: '#ecfeff',  border: '#a5f3fc' },
  '컨택':  { color: '#7c3aed', bg: '#f5f3ff',  border: '#ddd6fe' },
  'PoC':   { color: '#d97706', bg: '#fffbeb',  border: '#fde68a' },
  '제안':  { color: '#0284c7', bg: '#f0f9ff',  border: '#bae6fd' },
  '협상':  { color: '#c2410c', bg: '#fff7ed',  border: '#fed7aa' },
  '수주':  { color: '#16a34a', bg: '#f0fdf4',  border: '#bbf7d0' },
  '실패':  { color: '#dc2626', bg: '#fef2f2',  border: '#fecaca' },
}

function SortIcon({ field, sort, dir }: { field: SortField; sort: SortField; dir: 'asc' | 'desc' }) {
  if (sort !== field) return <ChevronsUpDown size={12} className="sort-icon" />
  return dir === 'asc'
    ? <ChevronUp size={12} className="sort-icon" />
    : <ChevronDown size={12} className="sort-icon" />
}

function StageBadge({ stage }: { stage: string }) {
  const st = STAGE_STYLE[stage] ?? STAGE_STYLE['신규']
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', color: st.color, background: st.bg, border: `1px solid ${st.border}`, flexShrink: 0 }}>
      {stage}
    </span>
  )
}

export default function DealsPage() {
  const [search, setSearch] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [sort, setSort] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<DealWithAccount | null>(null)

  const debouncedSearch = useDebounce(search, 300)

  const getKey = useCallback((pageIndex: number, prev: PageData | null) => {
    if (pageIndex > 0 && !prev?.nextCursor) return null
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (filterStage)     params.set('stage', filterStage)
    if (sort !== 'created_at') params.set('sort', sort)
    if (sortDir !== 'desc') params.set('dir', sortDir)
    if (prev?.nextCursor) params.set('cursor', prev.nextCursor)
    const qs = params.toString()
    return `/api/deals${qs ? `?${qs}` : ''}`
  }, [debouncedSearch, filterStage, sort, sortDir])

  const { data, size, setSize, isLoading, isValidating } = useSWRInfinite<PageData>(getKey)

  useEffect(() => { setSize(1) }, [debouncedSearch, filterStage, sort, sortDir, setSize])

  const list = data?.flatMap((p) => p.items) ?? []
  const hasMore = data?.[data.length - 1]?.hasMore ?? false
  const isCapped = data?.[data.length - 1]?.capped ?? false
  const hasFilters = debouncedSearch || filterStage || sort !== 'created_at'
  const totalCount = data?.[0]?.total ?? 0

  const activeList = list.filter(d => d.stage !== '실패')
  const totalValue = activeList.reduce((sum, d) => sum + (d.value ?? 0), 0)
  const wonValue   = list.filter(d => d.stage === '수주').reduce((sum, d) => sum + (d.value ?? 0), 0)

  const byStage = STAGES.reduce<Record<string, DealWithAccount[]>>((acc, s) => {
    acc[s] = list.filter(d => d.stage === s)
    return acc
  }, {})

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
    setFilterStage('')
    setSort('created_at')
    setSortDir('desc')
  }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>영업기회</h1>
          <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>영업 파이프라인 관리</p>
        </div>
        <Link href="/deals/new" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', minHeight: '44px' }}>
          <Plus size={16} /> 영업기회 추가
        </Link>
      </div>

      {/* 요약 카드 */}
      <div className="responsive-grid-cols-3" style={{ marginBottom: '1.5rem', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem 1.25rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 0.25rem', fontWeight: 500 }}>전체 기회</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>{totalCount}</p>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 0.25rem', fontWeight: 500 }}>파이프라인 총액</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#6366f1', margin: 0 }}>
            {totalValue > 0 ? `₩${(totalValue / 100000000).toFixed(1)}억` : '-'}
          </p>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 0.25rem', fontWeight: 500 }}>수주 완료</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#16a34a', margin: 0 }}>
            {wonValue > 0 ? `₩${(wonValue / 100000000).toFixed(1)}억` : '-'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
          <Loader2 size={24} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <>
          {/* 데스크탑: 칸반 (필터 없을 때) + 테이블 (항상 표시) */}
          {!hasFilters && (
            <div className="card desktop-only" style={{ marginBottom: '1.5rem' }}>
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingUp size={16} color="#6366f1" />
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>파이프라인</h2>
              </div>
              <div style={{ overflowX: 'auto', padding: '1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.filter(s => s !== '실패').length}, minmax(180px, 1fr))`, gap: '0.75rem', minWidth: '1200px' }}>
                  {STAGES.filter(s => s !== '실패').map((stage) => {
                    const st = STAGE_STYLE[stage]
                    const stageDeals = byStage[stage]
                    return (
                      <div key={stage}>
                        <div style={{ padding: '0.5rem 0.75rem', borderRadius: '0.5rem 0.5rem 0 0', background: st.bg, border: `1px solid ${st.border}`, borderBottom: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: st.color }}>{stage}</span>
                          <span style={{ fontSize: '0.75rem', color: st.color, background: 'rgba(0,0,0,0.05)', borderRadius: '9999px', padding: '0.1rem 0.4rem' }}>{stageDeals.length}</span>
                        </div>
                        <div style={{ border: `1px solid ${st.border}`, borderTop: 'none', borderRadius: '0 0 0.5rem 0.5rem', minHeight: '80px', display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem' }}>
                          {stageDeals.map((d) => (
                            <button
                              key={d.id}
                              onClick={() => setSelected(d)}
                              style={{ display: 'block', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.625rem 0.75rem', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                            >
                              <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#0f172a', marginBottom: '0.25rem', lineHeight: 1.3 }}>{d.title}</div>
                              {d.accounts?.name && <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{d.accounts.name}</div>}
                              {d.value && <div style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600, marginTop: '0.25rem' }}>₩{d.value.toLocaleString()}</div>}
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>확률 {d.probability}%</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 테이블 목록 */}
          <div className="card">
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={16} color="#6366f1" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 목록</h2>
              <span className="badge badge-slate">{list.length}{hasFilters ? '건 (필터됨)' : '건'}</span>
            </div>

            {/* 필터 바 */}
            <div className="filter-bar">
              <div className="filter-search-wrap">
                <Search size={14} />
                <input
                  className="filter-search"
                  placeholder="영업기회명 검색…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select className="filter-select" value={filterStage} onChange={e => setFilterStage(e.target.value)}>
                <option value="">단계 전체</option>
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {(search || filterStage || sort !== 'created_at') && (
                <button className="filter-clear" onClick={clearFilters}>
                  <X size={13} /> 초기화
                </button>
              )}
            </div>

            {list.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                {hasFilters ? '검색 결과가 없습니다' : '영업기회가 없습니다'}
              </div>
            ) : (
              <table className="table-base table-card">
                <thead>
                  <tr>
                    <th className={`sort-th${sort === 'title' ? ' active' : ''}`} onClick={() => handleSort('title')}>
                      영업기회 <SortIcon field="title" sort={sort} dir={sortDir} />
                    </th>
                    <th className={`sort-th${sort === 'stage' ? ' active' : ''}`} onClick={() => handleSort('stage')}>
                      단계 <SortIcon field="stage" sort={sort} dir={sortDir} />
                    </th>
                    <th className={`sort-th${sort === 'value' ? ' active' : ''}`} onClick={() => handleSort('value')}>
                      금액 <SortIcon field="value" sort={sort} dir={sortDir} />
                    </th>
                    <th className={`sort-th${sort === 'probability' ? ' active' : ''}`} onClick={() => handleSort('probability')}>
                      확률 <SortIcon field="probability" sort={sort} dir={sortDir} />
                    </th>
                    <th>리드유형</th>
                    <th>제품</th>
                    <th style={{ textAlign: 'center' }}>적합도</th>
                    <th>거래처</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(d)}>
                      <td className="card-header">
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
                          <div>
                            <button
                              onClick={() => setSelected(d)}
                              style={{ fontWeight: 600, color: '#0f172a', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9375rem', padding: 0, textAlign: 'left' }}
                            >
                              {d.title}
                            </button>
                            {d.accounts?.name && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.125rem' }}>{d.accounts.name}</div>}
                          </div>
                          <StageBadge stage={d.stage} />
                        </div>
                      </td>
                      <td data-label="단계"><StageBadge stage={d.stage} /></td>
                      <td data-label="금액">
                        {d.value
                          ? <span style={{ fontSize: '0.875rem', color: '#6366f1', fontWeight: 600 }}>₩{d.value.toLocaleString()}</span>
                          : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td data-label="확률">
                        <span style={{ fontSize: '0.875rem', color: '#374151' }}>{d.probability}%</span>
                      </td>
                      <td data-label="리드유형">
                        {d.lead_type
                          ? <span className="badge badge-slate" style={{ fontSize: '0.75rem' }}>{d.lead_type}</span>
                          : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td data-label="제품">
                        <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{d.product ?? '-'}</span>
                      </td>
                      <td data-label="적합도" style={{ textAlign: 'center' }}>
                        {d.fit_score !== null
                          ? <span style={{ fontSize: '0.75rem', fontWeight: 700, color: d.fit_score >= 70 ? '#16a34a' : d.fit_score >= 40 ? '#d97706' : '#dc2626' }}>{d.fit_score}</span>
                          : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td data-label="거래처" onClick={e => e.stopPropagation()}>
                        {d.accounts?.name ? (
                          <Link href={`/accounts/${d.account_id}`} style={{ fontSize: '0.875rem', color: '#6366f1', textDecoration: 'none' }}>
                            {d.accounts.name}
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
        </>
      )}

      <SlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? ''}>
        {selected && <DealDetail deal={selected} onClose={() => setSelected(null)} />}
      </SlidePanel>
    </div>
  )
}

function DealDetail({ deal: d, onClose }: { deal: DealWithAccount; onClose: () => void }) {
  const st = STAGE_STYLE[d.stage] ?? STAGE_STYLE['신규']
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
        <StageBadge stage={d.stage} />
        <span className="badge" style={{ background: '#f8fafc', color: '#64748b', fontSize: '0.75rem' }}>확률 {d.probability}%</span>
        {d.value && (
          <span className="badge" style={{ background: '#eef2ff', color: '#6366f1', fontWeight: 700, fontSize: '0.75rem' }}>
            ₩{d.value.toLocaleString()}
          </span>
        )}
      </div>

      <div className="detail-info-list">
        {d.accounts?.name && (
          <div className="detail-info-row">
            <Briefcase size={14} color="#6366f1" style={{ flexShrink: 0 }} />
            <Link href={`/accounts/${d.account_id}`} onClick={onClose} style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
              {d.accounts.name}
            </Link>
          </div>
        )}
        {d.close_date && (
          <div className="detail-info-row">
            <span className="detail-info-label">마감일</span>
            <span>{d.close_date}</span>
          </div>
        )}
        {d.next_action && (
          <div className="detail-info-row">
            <span className="detail-info-label">다음 액션</span>
            <span>{d.next_action}</span>
          </div>
        )}
        {d.description && (
          <p style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.6, margin: '0.5rem 0 0' }}>
            {d.description}
          </p>
        )}
        {d.tags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.25rem' }}>
            {d.tags.map(tag => (
              <span key={tag} className="badge" style={{ background: '#f0f9ff', color: '#0284c7', fontSize: '0.75rem' }}>#{tag}</span>
            ))}
          </div>
        )}
      </div>

      <div className="detail-actions">
        <Link href={`/deals/${d.id}`} className="detail-btn-primary" onClick={onClose}>
          <ExternalLink size={14} /> 전체 보기
        </Link>
        <Link href={`/deals/${d.id}/edit`} className="detail-btn-ghost" onClick={onClose}>
          편집
        </Link>
      </div>
    </div>
  )
}
