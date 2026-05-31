'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'

interface GpuProduct {
  id: string
  model_name: string
  memory: string
  tier: 1 | 2 | 3
  gpu_count: number
  pricing_mode: 'quote' | 'direct'
  lowest_unit_price_usd: number | null
  sell_price_krw: number | null
  sell_price_usd: number | null
}

interface ProductsResponse {
  products: GpuProduct[]
  margin_pct: number
  usd_krw: number
}

const TIER_INFO = {
  1: { label: 'Tier 1', desc: '전용 고성능·보장형', color: '#13151c' },
  2: { label: 'Tier 2', desc: '점유형(예약 단독)·보장형', color: '#1e40af' },
  3: { label: 'Tier 3', desc: '간헐 공급(중단/재개)·최저가', color: '#b45309' },
}

const GPU_ICONS: Record<string, string> = {
  H: '#1a1a2e',
  A: '#0d1b2a',
  B: '#1a0a2e',
  R: '#1a1a1a',
}

function GpuChip({ model, memory }: { model: string; memory: string }) {
  const letter = model[0]?.toUpperCase() ?? 'G'
  const bg = GPU_ICONS[letter] ?? '#1a1a1a'
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 36, height: 36, borderRadius: 8, background: bg,
        color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0,
        fontFamily: 'monospace', lineHeight: 1,
      }}
    >
      <span style={{ fontSize: 9 }}>{memory.replace('GB', '')}</span>
      <span style={{ fontSize: 7, opacity: 0.7 }}>GB</span>
    </span>
  )
}

export default function SalePriceCatalogPage() {
  const { data, isLoading } = useSWR<ProductsResponse>('/api/pricing/gpu/products', fetcher, {
    refreshInterval: 60000,
  })
  const [tierFilter, setTierFilter] = useState<0 | 1 | 2 | 3>(0)
  const [currencyMode, setCurrencyMode] = useState<'KRW' | 'USD'>('KRW')
  const [search, setSearch] = useState('')

  const products = data?.products ?? []
  const usdKrw = data?.usd_krw ?? 1400
  const marginPct = data?.margin_pct ?? 18

  const pricedProducts = products.filter((p) =>
    p.lowest_unit_price_usd != null || (p.pricing_mode === 'direct' && p.sell_price_krw != null)
  )

  const filtered = pricedProducts.filter((p) => {
    if (tierFilter !== 0 && p.tier !== tierFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return p.model_name.toLowerCase().includes(q) || p.memory.toLowerCase().includes(q)
    }
    return true
  })

  const getSellPrice = (p: GpuProduct) => {
    if (p.pricing_mode === 'direct') {
      if (!p.sell_price_krw) return null
      return { krw: p.sell_price_krw, usd: p.sell_price_krw / usdKrw }
    }
    if (!p.lowest_unit_price_usd) return null
    const usd = p.lowest_unit_price_usd * (1 + marginPct / 100)
    return { krw: Math.round(usd * usdKrw), usd }
  }

  return (
    <div className="page-inner">
      {/* 헤더 */}
      <div className="gpu-topbar">
        <div>
          <div className="gpu-crumb">가격정책</div>
          <h2 className="gpu-page-title">GPU 판매 가격표</h2>
        </div>
        <div className="gpu-topbar-right" style={{ gap: 8 }}>
          <div className="gpu-fx-pill" title="현재 적용 환율">
            <span className="gpu-fx-dot" />
            1 USD = <span className="gpu-mono">{Math.round(usdKrw).toLocaleString('ko-KR')}원</span>
          </div>
          <div className="gpu-fx-pill" style={{ color: 'var(--gpu-muted)', fontSize: 11 }}>
            마진 {marginPct}% 적용
          </div>
        </div>
      </div>

      {/* 필터 바 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 140, maxWidth: 280 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gpu-muted)' }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="모델 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="gpu-search"
            style={{ paddingLeft: 32, width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([0, 1, 2, 3] as const).map((t) => (
            <button
              key={t}
              className={`gpu-filter-btn${tierFilter === t ? ' active' : ''}`}
              onClick={() => setTierFilter(t)}
              style={t !== 0 ? {
                borderLeft: `3px solid ${TIER_INFO[t as 1|2|3].color}`,
              } : {}}
            >
              {t === 0 ? '전체' : `Tier ${t}`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {(['KRW', 'USD'] as const).map((c) => (
            <button
              key={c}
              className={`gpu-filter-btn${currencyMode === c ? ' active' : ''}`}
              onClick={() => setCurrencyMode(c)}
            >
              {c === 'KRW' ? '₩ 원' : '$ 달러'}
            </button>
          ))}
        </div>
      </div>

      {/* Tier 설명 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {([1, 2, 3] as const).map((t) => (
          <div
            key={t}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 6,
              background: 'var(--gpu-surface)',
              border: `1px solid var(--gpu-border)`,
              borderLeft: `3px solid ${TIER_INFO[t].color}`,
              fontSize: 11, color: 'var(--gpu-muted)',
            }}
          >
            <span style={{ fontWeight: 700, color: '#374151' }}>Tier {t}</span>
            <span>{TIER_INFO[t].desc}</span>
          </div>
        ))}
      </div>

      {/* 가격표 */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gpu-muted)' }}>
          로딩 중...
        </div>
      ) : (
        <div style={{ background: 'var(--gpu-surface)', borderRadius: 12, border: '1px solid var(--gpu-border)', overflow: 'hidden' }}>
          {/* 테이블 헤더 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto auto auto',
            gap: 12,
            padding: '10px 20px',
            background: 'var(--gpu-bg)',
            borderBottom: '1px solid var(--gpu-border)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--gpu-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            <span>GPU 모델</span>
            <span style={{ textAlign: 'center', minWidth: 60 }}>구분</span>
            <span style={{ textAlign: 'right', minWidth: 120 }}>판매가 / hr</span>
            <span style={{ textAlign: 'right', minWidth: 120 }}>판매가 / 월</span>
          </div>

          {/* 행 */}
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gpu-muted)', fontSize: 13 }}>
              {search ? `"${search}"에 해당하는 모델이 없습니다` : '등록된 가격이 없습니다'}
            </div>
          ) : (
            filtered.map((p) => {
              const price = getSellPrice(p)
              const tierConf = TIER_INFO[p.tier]
              const gpuCount = p.gpu_count ?? 1
              const monthlyKrw = price ? price.krw * 24 * 30 : null
              const monthlyUsd = price ? price.usd * 24 * 30 : null

              return (
                <div
                  key={p.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto',
                    gap: 12,
                    padding: '14px 20px',
                    alignItems: 'center',
                    borderBottom: '1px solid var(--gpu-border)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--gpu-hover)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  {/* 모델 정보 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <GpuChip model={p.model_name} memory={p.memory} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>
                        {p.model_name}
                        {gpuCount > 1 && (
                          <span style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 400, marginLeft: 6 }}>
                            ×{gpuCount}GPU
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gpu-muted)', marginTop: 1 }}>
                        {p.memory} VRAM
                      </div>
                    </div>
                  </div>

                  {/* Tier 배지 */}
                  <div style={{ textAlign: 'center' }}>
                    <span
                      className="gpu-badge"
                      style={{
                        background: tierConf.color,
                        color: '#fff',
                        fontSize: 10,
                        padding: '2px 8px',
                      }}
                    >
                      {tierConf.label}
                    </span>
                  </div>

                  {/* 시간당 판매가 */}
                  <div style={{ textAlign: 'right', minWidth: 120 }}>
                    {price ? (
                      <>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--gpu-accent)', fontFamily: 'monospace' }}>
                          {currencyMode === 'KRW'
                            ? `₩${price.krw.toLocaleString('ko-KR')}`
                            : `$${price.usd.toFixed(2)}`}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>
                          {currencyMode === 'KRW'
                            ? `$${price.usd.toFixed(2)}/hr`
                            : `₩${price.krw.toLocaleString('ko-KR')}/hr`}
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--gpu-muted)' }}>가격 준비 중</span>
                    )}
                  </div>

                  {/* 월 판매가 */}
                  <div style={{ textAlign: 'right', minWidth: 120 }}>
                    {price ? (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', fontFamily: 'monospace' }}>
                          {currencyMode === 'KRW'
                            ? `₩${Math.round(monthlyKrw!).toLocaleString('ko-KR')}`
                            : `$${monthlyUsd!.toFixed(0)}`}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>30일 × 24hr</div>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--gpu-muted)' }}>—</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--gpu-muted)', textAlign: 'right' }}>
        * 부가세 별도 · 가격은 시장 상황에 따라 변동될 수 있습니다
      </div>
    </div>
  )
}
