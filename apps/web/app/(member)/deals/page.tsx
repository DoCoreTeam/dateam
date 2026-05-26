'use client'

import useSWRInfinite from 'swr/infinite'
import { useRef, useEffect } from 'react'
import Link from 'next/link'
import { TrendingUp, Plus, Loader2 } from 'lucide-react'
import type { Deal, Account } from '@/types/database'

type DealWithAccount = Deal & { accounts: Pick<Account, 'name'> | null }
type PageData = { items: DealWithAccount[]; nextCursor: string | null; hasMore: boolean }

const PAGE_SIZE = 20
const STAGES = ['신규', '검증', '컨택', 'PoC', '제안', '협상', '수주', '실패'] as const
const STAGE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  '신규':  { color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' },
  '검증':  { color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
  '컨택':  { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  'PoC':   { color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  '제안':  { color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
  '협상':  { color: '#c2410c', bg: '#fff7ed', border: '#fed7aa' },
  '수주':  { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  '실패':  { color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
}

function getKey(pageIndex: number, prev: PageData | null) {
  if (pageIndex > 0 && !prev?.nextCursor) return null
  return prev?.nextCursor ? `/api/deals?cursor=${encodeURIComponent(prev.nextCursor)}` : '/api/deals'
}

export default function DealsPage() {
  const { data, size, setSize, isLoading, isValidating } = useSWRInfinite<PageData>(getKey)

  const list = data?.flatMap((p) => p.items) ?? []
  const hasMore = data?.[data.length - 1]?.hasMore ?? false

  const byStage = STAGES.reduce<Record<string, DealWithAccount[]>>((acc, s) => {
    acc[s] = list.filter((d) => d.stage === s)
    return acc
  }, {})
  const totalValue = list.filter((d) => d.stage !== '실패').reduce((sum, d) => sum + (d.value ?? 0), 0)
  const wonValue = list.filter((d) => d.stage === '수주').reduce((sum, d) => sum + (d.value ?? 0), 0)

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
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>{list.filter(d => d.stage !== '실패').length}</p>
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
          {/* 데스크탑: 칸반 */}
          <div className="card desktop-only">
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
                          <Link key={d.id} href={`/deals/${d.id}`} style={{ display: 'block', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.625rem 0.75rem', textDecoration: 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                            <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#0f172a', marginBottom: '0.25rem', lineHeight: 1.3 }}>{d.title}</div>
                            {d.accounts?.name && <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{d.accounts.name}</div>}
                            {d.value && <div style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600, marginTop: '0.25rem' }}>₩{d.value.toLocaleString()}</div>}
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>확률 {d.probability}%</div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 모바일: 테이블 카드 */}
          <div className="card mobile-only">
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 목록</h2>
            </div>
            {list.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.875rem' }}>영업기회가 없습니다</div>
            ) : (
              <table className="table-base table-card">
                <thead><tr><th>영업기회</th></tr></thead>
                <tbody>
                  {list.map((d) => {
                    const st = STAGE_STYLE[d.stage] ?? STAGE_STYLE['신규']
                    return (
                      <tr key={d.id}>
                        <td className="card-header">
                          <div style={{ width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.375rem' }}>
                              <Link href={`/deals/${d.id}`} style={{ fontWeight: 600, color: '#0f172a', textDecoration: 'none', fontSize: '0.9375rem' }}>{d.title}</Link>
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', color: st.color, background: st.bg, border: `1px solid ${st.border}`, flexShrink: 0 }}>{d.stage}</span>
                            </div>
                            {d.accounts?.name && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{d.accounts.name}</div>}
                            {d.value && <div style={{ fontSize: '0.8125rem', color: '#6366f1', fontWeight: 600, marginTop: '0.25rem' }}>₩{d.value.toLocaleString()}</div>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <div ref={sentinelRef} style={{ height: 1 }} />
      {isValidating && !isLoading && (
        <div style={{ textAlign: 'center', padding: '1rem', color: '#94a3b8' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      )}
    </div>
  )
}
