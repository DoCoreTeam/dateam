'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import Link from 'next/link'
import { TrendingUp, Plus, Loader2, Search, X, ExternalLink, Briefcase, ChevronUp, ChevronDown, ChevronsUpDown, Sparkles } from 'lucide-react'
import type { Deal, Account } from '@/types/database'
import SlidePanel from '@/components/ui/SlidePanel'
import PageHeader from '@/components/ui/PageHeader'
import { useDebounce } from '@/hooks/useDebounce'

type DealWithAccount = Deal & { accounts: Pick<Account, 'id' | 'name'> | null }
type PageData = { items: DealWithAccount[]; nextCursor: string | null; hasMore: boolean; total: number; capped?: boolean }
type SortField = 'created_at' | 'title' | 'stage' | 'value' | 'probability'

const STAGES = ['신규', '검증', '컨택', 'PoC', '제안', '협상', '수주', '실패'] as const
const STAGE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  '신규':  { color: 'var(--text-muted)', bg: 'var(--color-bg)',  border: 'var(--color-border)' },
  '검증':  { color: 'var(--info)', bg: 'var(--info-bg)',  border: 'var(--info-bg)' },
  '컨택':  { color: 'var(--brand)', bg: 'var(--brand-soft)',  border: 'var(--brand-soft-2)' },
  'PoC':   { color: 'var(--warning)', bg: 'var(--warning-bg)',  border: 'var(--warning-border)' },
  '제안':  { color: 'var(--info)', bg: 'var(--info-bg)',  border: 'var(--info-border)' },
  '협상':  { color: 'var(--warning)', bg: 'var(--warning-bg)',  border: 'var(--warning-border)' },
  '수주':  { color: 'var(--success)', bg: 'var(--success-bg)',  border: 'var(--success-border)' },
  '실패':  { color: 'var(--danger)', bg: 'var(--danger-bg)',  border: 'var(--danger-border)' },
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
    <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', color: st.color, background: st.bg, border: `var(--hairline) solid ${st.border}`, flexShrink: 0 }}>
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

  const { data, size, setSize, isLoading, isValidating, mutate } = useSWRInfinite<PageData>(getKey)

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
    <div className="page-inner">
      <PageHeader title="영업기회" description="영업 파이프라인 관리" actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link href="/lead-intake?target=deal" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', minHeight: '44px' }}>
            <Sparkles size={16} /> AI로 추가
          </Link>
          <Link href="/deals/new?mode=manual" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', minHeight: '44px', border: 'var(--border-w-2) solid var(--border-color)', color: 'var(--text-muted)', background: '#fff', fontSize: 'var(--fs-base)', fontWeight: 600 }}>
            <Plus size={16} /> 수동 입력
          </Link>
        </div>
      } />

      {/* 요약 카드 */}
      <div className="responsive-grid-cols-3" style={{ marginBottom: '1.5rem', gap: 'var(--space-4)' }}>
        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 0.25rem', fontWeight: 500 }}>전체 기회</p>
          <p style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{totalCount}</p>
        </div>
        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 0.25rem', fontWeight: 500 }}>파이프라인 총액</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--brand)', margin: 0 }}>
            {totalValue > 0 ? `₩${(totalValue / 100000000).toFixed(1)}억` : '-'}
          </p>
        </div>
        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 0.25rem', fontWeight: 500 }}>수주 완료</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)', margin: 0 }}>
            {wonValue > 0 ? `₩${(wonValue / 100000000).toFixed(1)}억` : '-'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-12) var(--space-4)' }}>
          <Loader2 size={24} style={{ color: 'var(--brand)', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <>
          {/* 데스크탑: 칸반 (필터 없을 때) + 테이블 (항상 표시) */}
          {!hasFilters && (
            <div className="card desktop-only" style={{ marginBottom: '1.5rem' }}>
              <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <TrendingUp size={16} color="var(--brand)" />
                <h2 className="tape-title" style={{ margin: 0 }}>파이프라인</h2>
              </div>
              <div style={{ overflowX: 'auto', padding: 'var(--space-5)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.filter(s => s !== '실패').length}, minmax(180px, 1fr))`, gap: 'var(--space-3)', minWidth: '1200px' }}>
                  {STAGES.filter(s => s !== '실패').map((stage) => {
                    const st = STAGE_STYLE[stage]
                    const stageDeals = byStage[stage]
                    return (
                      <div key={stage}>
                        <div style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: '0.5rem 0.5rem 0 0', background: st.bg, border: `var(--hairline) solid ${st.border}`, borderBottom: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: st.color }}>{stage}</span>
                          <span style={{ fontSize: 'var(--fs-xs)', color: st.color, background: 'rgba(0,0,0,0.05)', borderRadius: '9999px', padding: '0.1rem 0.4rem' }}>{stageDeals.length}</span>
                        </div>
                        <div style={{ border: `var(--hairline) solid ${st.border}`, borderTop: 'none', borderRadius: '0 0 0.5rem 0.5rem', minHeight: '80px', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2)' }}>
                          {stageDeals.map((d) => (
                            <button
                              key={d.id}
                              onClick={() => setSelected(d)}
                              style={{ display: 'block', background: 'white', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.625rem 0.75rem', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--text)', marginBottom: '0.25rem', lineHeight: 1.3 }}>{d.title}</div>
                              {d.accounts?.name && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{d.accounts.name}</div>}
                              {d.value && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', fontWeight: 600, marginTop: '0.25rem' }}>₩{d.value.toLocaleString()}</div>}
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>확률 {d.probability}%</div>
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
            <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <TrendingUp size={16} color="var(--brand)" />
              <h2 className="tape-title" style={{ margin: 0 }}>전체 목록</h2>
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
              <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-faint)', fontSize: 'var(--fs-base)' }}>
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
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)', width: '100%' }}>
                          <div>
                            <button
                              onClick={() => setSelected(d)}
                              style={{ fontWeight: 600, color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-md)', padding: 0, textAlign: 'left' }}
                            >
                              {d.title}
                            </button>
                            {d.accounts?.name && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{d.accounts.name}</div>}
                          </div>
                          <StageBadge stage={d.stage} />
                        </div>
                      </td>
                      <td data-label="단계"><StageBadge stage={d.stage} /></td>
                      <td data-label="금액">
                        {d.value
                          ? <span style={{ fontSize: 'var(--fs-base)', color: 'var(--brand)', fontWeight: 600 }}>₩{d.value.toLocaleString()}</span>
                          : <span style={{ color: 'var(--border-subtle)' }}>-</span>}
                      </td>
                      <td data-label="확률">
                        <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text)' }}>{d.probability}%</span>
                      </td>
                      <td data-label="리드유형">
                        {d.lead_type
                          ? <span className="badge badge-slate" style={{ fontSize: 'var(--fs-xs)' }}>{d.lead_type}</span>
                          : <span style={{ color: 'var(--border-subtle)' }}>-</span>}
                      </td>
                      <td data-label="제품">
                        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{d.product ?? '-'}</span>
                      </td>
                      <td data-label="적합도" style={{ textAlign: 'center' }}>
                        {d.fit_score !== null
                          ? <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: d.fit_score >= 70 ? 'var(--success)' : d.fit_score >= 40 ? 'var(--warning)' : 'var(--danger)' }}>{d.fit_score}</span>
                          : <span style={{ color: 'var(--border-subtle)' }}>-</span>}
                      </td>
                      <td data-label="거래처" onClick={e => e.stopPropagation()}>
                        {d.accounts?.name ? (
                          <Link href={`/accounts/${d.account_id}`} style={{ fontSize: 'var(--fs-base)', color: 'var(--brand)', textDecoration: 'none' }}>
                            {d.accounts.name}
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
        </>
      )}

      <SlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? ''}>
        {selected && <DealDetail deal={selected} onClose={() => setSelected(null)} onDeleted={() => { mutate(); setSelected(null) }} />}
      </SlidePanel>
    </div>
  )
}

function DealDetail({ deal: d, onClose, onDeleted }: { deal: DealWithAccount; onClose: () => void; onDeleted: () => void }) {
  const st = STAGE_STYLE[d.stage] ?? STAGE_STYLE['신규']
  async function handleDelete() {
    if (!confirm(`영업기회 "${d.title}"을(를) 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/deals/${d.id}`, { method: 'DELETE' })
    if (res.ok) onDeleted()
    else alert('삭제에 실패했습니다')
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
        <StageBadge stage={d.stage} />
        <span className="badge" style={{ background: 'var(--color-bg)', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>확률 {d.probability}%</span>
        {d.value && (
          <span className="badge" style={{ background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 700, fontSize: 'var(--fs-xs)' }}>
            ₩{d.value.toLocaleString()}
          </span>
        )}
      </div>

      <div className="detail-info-list">
        {d.accounts?.name && (
          <div className="detail-info-row">
            <Briefcase size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <Link href={`/accounts/${d.account_id}`} onClick={onClose} style={{ color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
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
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', lineHeight: 1.6, margin: '0.5rem 0 0' }}>
            {d.description}
          </p>
        )}
        {d.tags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.25rem' }}>
            {d.tags.map(tag => (
              <span key={tag} className="badge" style={{ background: 'var(--info-bg)', color: 'var(--info)', fontSize: 'var(--fs-xs)' }}>#{tag}</span>
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
        <button onClick={handleDelete} className="detail-btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--danger-border)', cursor: 'pointer' }}>
          삭제
        </button>
      </div>
    </div>
  )
}
