'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { RefreshCw, TrendingUp, AlertTriangle } from 'lucide-react'

interface Competitor {
  id: string
  name: string
  short_name: string
  type: string
  region: string
  color: string
}

interface MarketEntry {
  mapping_id: string
  competitor: Competitor
  product: { id: string; model_name: string; memory: string; tier: number }
  competitor_sku: string
  pricing_model: string
  region: string | null
  price_usd: number | null
  hours_ago: number | null
  is_fresh: boolean
  confidence: number | null
  notes: string | null
}

interface ProductGroup {
  product: { id: string; model_name: string; memory: string; tier: number }
  competitors: MarketEntry[]
  our_price_usd: number | null
  market_min: number | null
  market_max: number | null
  market_median: number | null
}

interface MarketData {
  competitors: Competitor[]
  products: ProductGroup[]
  summary: {
    low_count: number
    mid_count: number
    high_count: number
    competitor_count: number
  }
}

const PRICING_MODEL_LABEL: Record<string, string> = {
  on_demand: 'On-Demand',
  reserved_1y: '1년 약정',
  reserved_3y: '3년 약정',
  spot: 'Spot',
  committed: '커밋',
}

const TIER_BADGE: Record<number, { label: string; color: string }> = {
  1: { label: 'T1', color: 'var(--gpu-purple)' },
  2: { label: 'T2', color: 'var(--gpu-blue)' },
  3: { label: 'T3', color: 'var(--gpu-amber)' },
}

function FreshnessDot({ hoursAgo, maxHours = 48 }: { hoursAgo: number | null; maxHours?: number }) {
  if (hoursAgo === null) return <span style={{ color: 'var(--gpu-faint)', fontSize: 11 }}>—</span>
  const isFresh = hoursAgo <= maxHours
  const isWarn = hoursAgo > maxHours * 0.75
  const color = !isFresh ? 'var(--gpu-red)' : isWarn ? 'var(--gpu-amber)' : 'var(--gpu-green)'
  const label = hoursAgo < 1 ? '방금' : hoursAgo < 24 ? `${hoursAgo}h` : `${Math.round(hoursAgo / 24)}d`
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function PositionBar({
  ourPrice,
  marketMin,
  marketMax,
  marketMedian,
}: {
  ourPrice: number | null
  marketMin: number | null
  marketMax: number | null
  marketMedian: number | null
}) {
  if (ourPrice == null || marketMin == null || marketMax == null || marketMin === marketMax) {
    return <span style={{ fontSize: 11, color: 'var(--gpu-faint)', fontStyle: 'italic' }}>데이터 부족</span>
  }
  const range = marketMax - marketMin
  const pct = Math.max(0, Math.min(100, ((ourPrice - marketMin) / range) * 100))
  const isLow = ourPrice < (marketMedian ?? marketMax) * 0.9
  const isHigh = ourPrice > (marketMedian ?? marketMin) * 1.1
  const markerColor = isLow ? '#15a35a' : isHigh ? '#e0405a' : '#d97706'

  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ fontSize: 10, color: 'var(--gpu-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'monospace' }}>${marketMin.toFixed(2)}</span>
        <span style={{ fontFamily: 'monospace' }}>${marketMax.toFixed(2)}</span>
      </div>
      <div style={{ position: 'relative', height: 6, background: 'linear-gradient(90deg,#e7f5ec 0%,#fef3e2 50%,#fdebee 100%)', borderRadius: 3 }}>
        <div style={{
          position: 'absolute', top: -4, left: `${pct}%`,
          width: 0, height: 0,
          borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
          borderTop: `7px solid ${markerColor}`,
          transform: 'translateX(-5px)',
        }} />
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--gpu-muted)' }}>
        <span style={{ fontWeight: 700, color: markerColor }}>
          {isLow ? '저가 ↓' : isHigh ? '고가 ↑' : '중간'}
        </span>
        {marketMedian != null && (
          <span style={{ marginLeft: 6 }}>중앙값 <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>${marketMedian.toFixed(2)}</span></span>
        )}
      </div>
    </div>
  )
}

export default function MarketTab() {
  const { data, isLoading, mutate } = useSWR<MarketData>('/api/pricing/gpu/market', fetcher, {
    refreshInterval: 0,
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activeComps, setActiveComps] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)

  const summary = data?.summary
  const products = data?.products ?? []
  const competitors = data?.competitors ?? []

  const toggleComp = (id: string) => {
    setActiveComps(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await mutate()
    setRefreshing(false)
  }

  const filteredProducts = products.map(p => ({
    ...p,
    competitors: activeComps.size === 0
      ? p.competitors
      : p.competitors.filter(c => activeComps.has(c.competitor.id)),
  }))

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <div className="gpu-spinner" />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 안내 배너 */}
      <div className="gpu-banner" style={{ marginBottom: 0 }}>
        <TrendingUp size={16} color="var(--gpu-accent)" style={{ flexShrink: 0 }} />
        <div>
          <b>경쟁사 시장 트랙</b> · 공급가·판매가와 독립된 차원에서 경쟁사 가격 추적 · 신선도 <b>48시간</b> ·{' '}
          <span style={{ color: 'var(--gpu-muted)' }}>수집 가격은 내부 의사결정용 — 외부 자료에 직접 인용 금지</span>
        </div>
        <button
          className="gpu-btn"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw size={12} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
          새로고침
        </button>
      </div>

      {/* 요약 통계 */}
      {summary && (
        <div className="responsive-grid-cols-4" style={{ gap: 12 }}>
          <div className="gpu-stat-card">
            <div className="gpu-stat-label">저가 진영 모델</div>
            <div className="gpu-stat-value" style={{ color: 'var(--gpu-green)' }}>
              {summary.low_count}<span className="gpu-stat-unit">/{products.length}</span>
            </div>
            <div className="gpu-stat-sub">시장 하위 33% 안</div>
          </div>
          <div className="gpu-stat-card">
            <div className="gpu-stat-label">중간 진영</div>
            <div className="gpu-stat-value" style={{ color: 'var(--gpu-amber)' }}>
              {summary.mid_count}<span className="gpu-stat-unit">/{products.length}</span>
            </div>
            <div className="gpu-stat-sub">중앙값 ±10% 이내</div>
          </div>
          <div className="gpu-stat-card">
            <div className="gpu-stat-label">고가 진영</div>
            <div className="gpu-stat-value" style={{ color: 'var(--gpu-red)' }}>
              {summary.high_count}<span className="gpu-stat-unit">/{products.length}</span>
            </div>
            <div className="gpu-stat-sub">재가격 검토 권고</div>
          </div>
          <div className="gpu-stat-card">
            <div className="gpu-stat-label">활성 경쟁사</div>
            <div className="gpu-stat-value" style={{ color: 'var(--gpu-accent)' }}>
              {summary.competitor_count}<span className="gpu-stat-unit">곳</span>
            </div>
            <div className="gpu-stat-sub">global·domestic</div>
          </div>
        </div>
      )}

      {/* 경쟁사 필터 토글 */}
      {competitors.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 7, padding: '12px 14px',
          background: '#fff', border: '1px solid var(--gpu-border)', borderRadius: 11, alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 4 }}>
            경쟁사 필터:
          </span>
          <button
            className={`gpu-comp-chip${activeComps.size === 0 ? ' active' : ''}`}
            onClick={() => setActiveComps(new Set())}
          >
            전체
          </button>
          {competitors.map(c => (
            <button
              key={c.id}
              className={`gpu-comp-chip${activeComps.has(c.id) ? ' active' : ''}`}
              onClick={() => toggleComp(c.id)}
              style={activeComps.has(c.id) ? { borderColor: c.color, color: c.color, background: `${c.color}15` } : {}}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, display: 'inline-block' }} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* 모델별 시장 포지셔닝 매트릭스 */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gpu-ink)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          모델별 시장 포지셔닝
          <span style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 500 }}>— 행 클릭으로 경쟁사 상세 펼침</span>
        </div>

        <div className="gpu-panel" style={{ overflow: 'hidden' }}>
          {/* 헤더 */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.5fr 36px',
            gap: 14, padding: '10px 18px',
            background: '#fafbfc', borderBottom: '1px solid var(--gpu-border)',
            fontSize: 10.5, color: 'var(--gpu-muted)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            <div>GPU 모델 / Tier</div>
            <div>gcube 판매가</div>
            <div>시장 범위 (USD/hr)</div>
            <div>가격 포지셔닝</div>
            <div />
          </div>

          {filteredProducts.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--gpu-faint)' }}>
              <AlertTriangle size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
              <div style={{ fontSize: 13 }}>시장 데이터가 없습니다</div>
            </div>
          ) : (
            filteredProducts.map(p => {
              const pid = p.product.id
              const isOpen = expandedId === pid
              const tier = p.product.tier
              const tierCfg = TIER_BADGE[tier] ?? { label: 'T?', color: 'var(--gpu-muted)' }

              const freshComps = p.competitors.filter(c => c.is_fresh && c.price_usd != null)
              const allPrices = freshComps.map(c => c.price_usd as number).sort((a, b) => a - b)
              const min = allPrices[0] ?? null
              const max = allPrices[allPrices.length - 1] ?? null

              return (
                <div key={pid}>
                  {/* 메인 행 */}
                  <div
                    onClick={() => setExpandedId(isOpen ? null : pid)}
                    style={{
                      display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.5fr 36px',
                      gap: 14, padding: '14px 18px', alignItems: 'center',
                      cursor: 'pointer', transition: '.12s',
                      background: isOpen ? 'var(--gpu-accent-bg)' : '#fff',
                      borderBottom: '1px solid #f1f2f6',
                    }}
                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = '#fafbff' }}
                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = '#fff' }}
                  >
                    {/* 모델명 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 8, background: '#13151c',
                        color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', flexShrink: 0, fontFamily: 'monospace', fontSize: 9, fontWeight: 700, lineHeight: 1.2,
                      }}>
                        GPU<span style={{ fontSize: 7, opacity: .6 }}>chip</span>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                          {p.product.model_name}
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--gpu-muted)', marginLeft: 4 }}>{p.product.memory}</span>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5,
                          background: `${tierCfg.color}20`, color: tierCfg.color,
                        }}>
                          {tierCfg.label}
                        </span>
                      </div>
                    </div>

                    {/* gcube 판매가 */}
                    <div>
                      {p.our_price_usd != null ? (
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: 'var(--gpu-accent)' }}>
                          ${p.our_price_usd.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--gpu-muted)', fontWeight: 400 }}>/hr</span>
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--gpu-faint)' }}>공급가 없음</span>
                      )}
                    </div>

                    {/* 시장 범위 */}
                    <div>
                      {min != null && max != null ? (
                        <div>
                          <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12.5 }}>
                            ${min.toFixed(2)} ~ ${max.toFixed(2)}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--gpu-muted)', marginTop: 2 }}>
                            {freshComps.length}개 경쟁사 (신선)
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--gpu-faint)', fontStyle: 'italic' }}>데이터 없음</span>
                      )}
                    </div>

                    {/* 포지셔닝 바 */}
                    <PositionBar
                      ourPrice={p.our_price_usd}
                      marketMin={p.market_min}
                      marketMax={p.market_max}
                      marketMedian={p.market_median}
                    />

                    {/* 화살표 */}
                    <div style={{ color: 'var(--gpu-faint)', transition: '.2s', transform: isOpen ? 'rotate(180deg)' : 'none', display: 'flex', justifyContent: 'center' }}>
                      ▼
                    </div>
                  </div>

                  {/* 펼침 영역 */}
                  {isOpen && (
                    <div style={{ background: '#fbfcfe', borderBottom: '1px solid #f1f2f6', padding: '12px 18px 18px' }}>
                      <div style={{ fontSize: 11.5, color: 'var(--gpu-muted)', fontWeight: 600, marginBottom: 10 }}>
                        경쟁사별 상세 가격
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {p.competitors.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--gpu-faint)', padding: '12px 0' }}>
                            해당 경쟁사 데이터 없음
                          </div>
                        ) : (
                          p.competitors.map(c => {
                            const pm = PRICING_MODEL_LABEL[c.pricing_model] ?? c.pricing_model
                            const diffPct = (p.our_price_usd != null && c.price_usd != null)
                              ? ((p.our_price_usd - c.price_usd) / c.price_usd * 100)
                              : null
                            const isCheaper = diffPct != null && diffPct > 0
                            const isPricier = diffPct != null && diffPct < 0

                            return (
                              <div key={c.mapping_id} style={{
                                display: 'grid', gridTemplateColumns: '1.3fr 1fr .9fr .9fr .9fr',
                                gap: 14, alignItems: 'center', padding: '11px 14px',
                                background: isPricier ? 'linear-gradient(90deg,#fef4f5,#fff)' : isCheaper ? 'linear-gradient(90deg,#f6faf7,#fff)' : '#fff',
                                border: `1px solid ${isPricier ? '#f5d2d8' : isCheaper ? '#cfe7d8' : 'var(--gpu-border)'}`,
                                borderRadius: 10, fontSize: 12.5,
                              }}>
                                {/* 경쟁사 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.competitor.color, flexShrink: 0 }} />
                                  {c.competitor.name}
                                  <span style={{ fontSize: 10, color: 'var(--gpu-muted)', fontFamily: 'monospace' }}>{c.competitor_sku}</span>
                                </div>

                                {/* 가격 */}
                                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13.5 }}>
                                  {c.price_usd != null ? `$${c.price_usd.toFixed(2)}` : '—'}
                                </div>

                                {/* 가격 모델 */}
                                <div>
                                  <span style={{
                                    fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5,
                                    background: 'var(--gpu-accent-bg)', color: 'var(--gpu-accent)',
                                  }}>
                                    {pm}
                                  </span>
                                </div>

                                {/* vs 우리 가격 */}
                                <div>
                                  {diffPct != null ? (
                                    <span style={{
                                      fontSize: 11, fontWeight: 700, fontFamily: 'monospace', padding: '2px 7px', borderRadius: 5,
                                      background: isCheaper ? 'var(--gpu-green-bg)' : isPricier ? '#fdebee' : '#f0f1f4',
                                      color: isCheaper ? 'var(--gpu-green)' : isPricier ? 'var(--gpu-red)' : 'var(--gpu-muted)',
                                    }}>
                                      {isCheaper ? '우리↑' : isPricier ? '우리↓' : '='}
                                      {Math.abs(diffPct).toFixed(1)}%
                                    </span>
                                  ) : '—'}
                                </div>

                                {/* 신선도 */}
                                <div>
                                  <FreshnessDot hoursAgo={c.hours_ago} maxHours={48} />
                                  {!c.is_fresh && (
                                    <span style={{ fontSize: 10, color: 'var(--gpu-red)', marginLeft: 4 }}>만료</span>
                                  )}
                                  {c.notes && (
                                    <div style={{ fontSize: 10, color: 'var(--gpu-amber)', marginTop: 2 }}>⚠ {c.notes}</div>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 하단 면책 */}
      <div style={{
        fontSize: 11.5, color: 'var(--gpu-faint)', padding: '10px 14px',
        background: '#fafbfc', border: '1px solid var(--gpu-border)', borderRadius: 9,
        display: 'flex', alignItems: 'center', gap: 7,
      }}>
        ⓘ 수집한 경쟁사 가격은 <b style={{ color: 'var(--gpu-ink-2)' }}>내부 의사결정용</b>입니다 ·
        외부 자료(제안서·홈페이지)에 직접 인용 금지 · 신선도 기준: <b style={{ color: 'var(--gpu-ink-2)' }}>48시간</b>
      </div>
    </div>
  )
}
