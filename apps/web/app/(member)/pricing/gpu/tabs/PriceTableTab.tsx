'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { ChevronRight, Plus, Zap, Info, ArrowUpDown, ArrowUp, ArrowDown, Tag } from 'lucide-react'

type SortKey = 'model' | 'supply' | 'sell'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sortConfig }: { col: SortKey; sortConfig: { key: SortKey; dir: SortDir } | null }) {
  if (sortConfig?.key !== col) return <ArrowUpDown size={11} style={{ opacity: 0.35, marginLeft: 3, verticalAlign: 'middle' }} />
  return sortConfig.dir === 'asc'
    ? <ArrowUp size={11} style={{ color: 'var(--gpu-accent)', marginLeft: 3, verticalAlign: 'middle' }} />
    : <ArrowDown size={11} style={{ color: 'var(--gpu-accent)', marginLeft: 3, verticalAlign: 'middle' }} />
}

interface Supplier {
  name: string
  color: string
  location?: string
}

interface GpuProduct {
  id: string
  model_name: string
  memory: string
  tier: 1 | 2 | 3
  gpu_count: number
  pricing_mode: 'quote' | 'direct'
  lowest_unit_price_usd: number | null
  lowest_supplier: Supplier | null
  lowest_valid_until: string | null
  sell_price_krw: number | null
  sell_price_usd: number | null
  pending_count: number
}

interface ProductsResponse {
  products: GpuProduct[]
  margin_pct: number
  usd_krw: number
  fx_date: string | null
}

interface PartnerTier {
  id: string
  name: string
  discount_rate: number
}

interface Quote {
  id: string
  unit_price_usd: number
  term: string | null
  min_qty: string | null
  valid_until: string | null
  source_format: string | null
  ai_confidence: number | null
  suppliers: Supplier | null
}

const TIER_CONFIG = {
  1: { label: 'Tier 1', name: '전용 고성능', badge: 'gpu-badge-t1', chipColor: '#13151c' },
  2: { label: 'Tier 2', name: '점유형',     badge: 'gpu-badge-t2', chipColor: '#1e40af' },
  3: { label: 'Tier 3', name: '간헐 공급',   badge: 'gpu-badge-t3', chipColor: '#b45309' },
}

const fmtUSD = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtKRW = (v: number) => '₩' + Math.round(v).toLocaleString('ko-KR')
const fmtDday = (dateStr: string) => {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (diff < 0) return { label: '만료', color: 'var(--gpu-red)' }
  if (diff <= 7) return { label: `D-${diff}`, color: 'var(--gpu-amber)' }
  return { label: `D-${diff}`, color: 'var(--gpu-green)' }
}

interface ExpandedRowProps {
  productId: string
  usdKrw: number
  marginPct: number
  currencyMode: 'KRW' | 'USD'
}

function ExpandedRow({ productId, usdKrw, marginPct, currencyMode }: ExpandedRowProps) {
  const { data } = useSWR<{ quotes: Quote[] }>(
    `/api/pricing/gpu/quotes?product_id=${productId}`,
    fetcher
  )
  const quotes = data?.quotes ?? []

  if (quotes.length === 0) {
    return (
      <div className="gpu-expand-empty">
        확정된 견적이 없습니다 — 견적 등록 탭에서 공급 견적을 등록해 주세요.
      </div>
    )
  }

  return (
    <div className="gpu-expand-body">
      <div className="gpu-expand-head">
        <Info size={13} /> 전체 공급사 견적 (낮은 순) · 최저가는 동일 tier 내에서만 비교
      </div>
      {quotes.map((q, i) => {
        const sellKrw = q.unit_price_usd * (1 + marginPct / 100) * usdKrw
        const dday = q.valid_until ? fmtDday(q.valid_until) : null
        const isBest = i === 0
        return (
          <div key={q.id} className={`gpu-qline${isBest ? ' gpu-qline-best' : ''}`}>
            <div className="gpu-qline-sup">
              {q.suppliers && (
                <span className="gpu-sdot" style={{ background: q.suppliers.color }} />
              )}
              <span style={{ fontWeight: 600 }}>{q.suppliers?.name ?? '—'}</span>
              {isBest && <span className="gpu-badge-best">최저가</span>}
            </div>
            <div>
              <div className="gpu-mono" style={{ fontSize: '13.5px', fontWeight: 700 }}>
                {currencyMode === 'KRW' ? fmtKRW(Math.round(q.unit_price_usd * usdKrw)) : fmtUSD(q.unit_price_usd)}
                <span style={{ fontSize: '10px', color: 'var(--gpu-muted)', fontWeight: 400 }}>/GPU·hr</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--gpu-muted)', marginTop: 2 }}>
                {currencyMode === 'KRW'
                  ? <>{fmtUSD(q.unit_price_usd)} · 판매 {fmtKRW(sellKrw)}/hr</>
                  : <>판매 {fmtUSD(sellKrw / usdKrw)}/hr · {fmtKRW(sellKrw)}</>}
              </div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--gpu-muted)' }}>{q.term ?? '—'}</div>
            <div style={{ fontSize: '11px', color: 'var(--gpu-muted)' }}>{q.min_qty ?? '—'}</div>
            <div>
              {dday && (
                <span className="gpu-mono" style={{ fontSize: '10.5px', fontWeight: 700, color: dday.color }}>
                  {dday.label}
                </span>
              )}
              {q.valid_until && (
                <div style={{ fontSize: '10px', color: 'var(--gpu-faint)' }}>{q.valid_until}</div>
              )}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--gpu-faint)' }}>
              {q.ai_confidence != null && (
                <div className="gpu-conf">
                  <div className="gpu-conf-bar">
                    <i
                      className={q.ai_confidence >= 80 ? '' : q.ai_confidence >= 50 ? 'mid' : 'low'}
                      style={{ width: `${q.ai_confidence}%` }}
                    />
                  </div>
                  {q.ai_confidence}%
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface PriceTableTabProps {
  onGoToIntake: () => void
  onGoToReview?: () => void
  initialSearch?: string
  onSearchConsumed?: () => void
  initialProductId?: string | null
  onProductFocusConsumed?: () => void
}

export default function PriceTableTab({ onGoToIntake, onGoToReview, initialSearch, onSearchConsumed, initialProductId, onProductFocusConsumed }: PriceTableTabProps) {
  const { data, mutate: revalidate } = useSWR<ProductsResponse>('/api/pricing/gpu/products', fetcher, {
    refreshInterval: 60000,
  })
  const { data: partnerData } = useSWR<{ tiers: PartnerTier[] }>('/api/pricing/gpu/partner-tiers', fetcher)
  const partnerTiers = partnerData?.tiers ?? []
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)
  const [tierFilter, setTierFilter] = useState(0)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [marginInput, setMarginInput] = useState<number | null>(null)
  const [marginSaving, setMarginSaving] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [currencyMode, setCurrencyMode] = useState<'KRW' | 'USD'>('KRW')
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; dir: SortDir } | null>(null)

  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch)
      onSearchConsumed?.()
    }
  }, [initialSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!initialProductId) return
    setExpandedId(initialProductId)
    onProductFocusConsumed?.()
    // scroll the row into view after render
    requestAnimationFrame(() => {
      const row = document.getElementById(`gpu-row-${initialProductId}`)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [initialProductId]) // eslint-disable-line react-hooks/exhaustive-deps

  const products = data?.products ?? []
  const marginPct = marginInput ?? data?.margin_pct ?? 18
  const usdKrw = data?.usd_krw ?? 1400
  const fxDate = data?.fx_date

  // 견적 있는 상품만 기본 표시 (confirmed quote 또는 direct 판매가)
  const pricedProducts = products.filter((p) =>
    p.lowest_unit_price_usd != null || (p.pricing_mode === 'direct' && p.sell_price_krw != null)
  )
  const [showAll, setShowAll] = useState(false)

  const filtered = (showAll ? products : pricedProducts).filter((p) => {
    if (tierFilter !== 0 && p.tier !== tierFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return p.model_name.toLowerCase().includes(q) || p.memory.toLowerCase().includes(q)
    }
    return true
  })

  const stats = {
    total: products.length,
    t1: products.filter((p) => p.tier === 1).length,
    t2: products.filter((p) => p.tier === 2).length,
    t3: products.filter((p) => p.tier === 3).length,
    pending: products.reduce((a, p) => a + p.pending_count, 0),
  }

  const handleMarginSave = useCallback(async (val: number) => {
    setMarginSaving(true)
    try {
      const res = await fetch('/api/pricing/gpu/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ margin_pct: val }),
      })
      if (res.ok) {
        setMarginInput(null)
        await revalidate()
      }
    } finally {
      setMarginSaving(false)
    }
  }, [revalidate])

  const computeSellKrw = (p: GpuProduct) => {
    if (p.pricing_mode === 'direct') return p.sell_price_krw
    if (p.lowest_unit_price_usd == null) return null
    return Math.round(p.lowest_unit_price_usd * (1 + marginPct / 100) * usdKrw)
  }

  const selectedTier = partnerTiers.find((t) => t.id === selectedTierId) ?? null
  const computePartnerKrw = (sellKrw: number | null) => {
    if (sellKrw == null || selectedTier == null) return null
    return Math.round(sellKrw * (1 - selectedTier.discount_rate / 100))
  }
  const colCount = selectedTier ? 7 : 6

  const handleSort = (key: SortKey) => {
    setSortConfig((prev) =>
      prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  const sorted = sortConfig
    ? [...filtered].sort((a, b) => {
        const dir = sortConfig.dir === 'asc' ? 1 : -1
        if (sortConfig.key === 'model') return a.model_name.localeCompare(b.model_name, 'ko') * dir
        if (sortConfig.key === 'supply') {
          const aP = a.lowest_unit_price_usd ?? (dir > 0 ? Infinity : -Infinity)
          const bP = b.lowest_unit_price_usd ?? (dir > 0 ? Infinity : -Infinity)
          return (aP - bP) * dir
        }
        if (sortConfig.key === 'sell') {
          const aS = computeSellKrw(a) ?? (dir > 0 ? Infinity : -Infinity)
          const bS = computeSellKrw(b) ?? (dir > 0 ? Infinity : -Infinity)
          return (aS - bS) * dir
        }
        return 0
      })
    : filtered

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── 고정 헤더 영역 ── */}
      <div style={{ flexShrink: 0 }}>
      {/* 최저가 갱신 배너 */}
      {!bannerDismissed && stats.pending > 0 && (
        <div className="gpu-banner">
          <div className="gpu-banner-dot">
            <Zap size={16} color="#5b5ef0" />
          </div>
          <div>
            <strong>검토 대기</strong> · AI 추출 견적 <strong>{stats.pending}건</strong>이 검토를 기다리고 있습니다 — 검토 대기 탭에서 확인 후 확정하면 가격표에 반영됩니다
          </div>
          <button className="gpu-banner-close" onClick={() => setBannerDismissed(true)}>×</button>
        </div>
      )}

      {/* 통계 */}
      <div className="gpu-stats">
        <div
          className="gpu-stat gpu-stat-clickable"
          title="클릭하면 Tier 필터 순환"
          onClick={() => setTierFilter(t => (t + 1) % 4 as 0 | 1 | 2 | 3)}
        >
          <div className="gpu-stat-lbl">관리 상품 (모델×tier)</div>
          <div className="gpu-stat-val">{stats.total}<span className="gpu-stat-unit">개</span></div>
          <div className="gpu-stat-sub">T1 {stats.t1} · T2 {stats.t2} · T3 {stats.t3}{tierFilter > 0 ? ` · T${tierFilter} 필터 중` : ''}</div>
        </div>
        <div
          className="gpu-stat gpu-stat-clickable"
          title="견적 확정 상품만 보기"
          onClick={() => { setShowAll(false); setTierFilter(0) }}
        >
          <div className="gpu-stat-lbl">T1·T2 최저가 보유</div>
          <div className="gpu-stat-val">
            {products.filter((p) => p.tier !== 3 && p.lowest_unit_price_usd != null).length}
            <span className="gpu-stat-unit">개</span>
          </div>
          <div className="gpu-stat-sub">견적 확정 상품</div>
        </div>
        <div
          className="gpu-stat gpu-stat-clickable"
          title="검토 대기 탭으로 이동"
          onClick={() => onGoToReview?.()}
        >
          <div className="gpu-stat-lbl">검토 대기 견적</div>
          <div className="gpu-stat-val" style={{ color: stats.pending > 0 ? 'var(--gpu-amber)' : undefined }}>
            {stats.pending}<span className="gpu-stat-unit">건</span>
          </div>
          <div className="gpu-stat-sub">{stats.pending > 0 ? '클릭하면 검토 탭으로' : '확정 전 가격표 미반영'}</div>
        </div>
        <div className="gpu-stat">
          <div className="gpu-stat-lbl">오늘 환율</div>
          <div className="gpu-stat-val gpu-mono" style={{ fontSize: '18px' }}>
            {usdKrw.toLocaleString('ko-KR')}
          </div>
          <div className="gpu-stat-sub">KRW/USD{fxDate ? ` · ${fxDate}` : ''}</div>
        </div>
      </div>

      {/* 툴바 */}
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input
            placeholder="모델명 검색 (H100, B200, 4090 ...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="gpu-seg">
          {([0, 1, 2, 3] as const).map((t) => (
            <button
              key={t}
              className={tierFilter === t ? 'on' : ''}
              onClick={() => setTierFilter(t)}
            >
              {t === 0 ? `전체 ${products.length}` : `T${t} · ${[stats.t1, stats.t2, stats.t3][t - 1]}`}
            </button>
          ))}
        </div>
        {/* 통화 토글 */}
        <div className="gpu-seg">
          <button className={currencyMode === 'KRW' ? 'on' : ''} onClick={() => setCurrencyMode('KRW')} title="원화 기준으로 표시">₩ 원</button>
          <button className={currencyMode === 'USD' ? 'on' : ''} onClick={() => setCurrencyMode('USD')} title="달러 기준으로 표시">$ 달러</button>
        </div>
        <div className="gpu-seg">
          <button
            className={!showAll ? 'on' : ''}
            onClick={() => setShowAll(false)}
            title="견적이 확정된 상품만 표시"
          >
            견적확정만 · {pricedProducts.length}
          </button>
          <button
            className={showAll ? 'on' : ''}
            onClick={() => setShowAll(true)}
            title="견적 없는 상품 포함 전체 표시"
          >
            전체상품 · {products.length}
          </button>
        </div>
        {partnerTiers.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Tag size={13} style={{ color: 'var(--gpu-muted)', flexShrink: 0 }} />
            <select
              value={selectedTierId ?? ''}
              onChange={(e) => setSelectedTierId(e.target.value || null)}
              style={{
                fontSize: '12px', padding: '0.3rem 0.5rem', borderRadius: '0.375rem',
                border: '1px solid var(--gpu-border)', background: 'var(--gpu-surface)',
                color: selectedTierId ? 'var(--gpu-accent)' : 'var(--gpu-muted)',
                cursor: 'pointer', outline: 'none', fontWeight: selectedTierId ? 600 : 400,
              }}
            >
              <option value="">파트너 할인 없음</option>
              {partnerTiers.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.discount_rate}%↓)</option>
              ))}
            </select>
          </div>
        )}
        <button className="gpu-btn gpu-btn-primary" onClick={onGoToIntake}>
          <Plus size={15} /> 견적 등록
        </button>
      </div>

      {/* 마진 바 */}
      <div className="gpu-margin-bar">
        <div className="gpu-mb-left">
          <div className="gpu-mb-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5b5ef0" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          </div>
          <div>
            <strong>gcube 판매 마진</strong>
            <div className="gpu-mb-eq">최저 공급원가 × (1 + 마진) = 판매가</div>
          </div>
        </div>
        <div className="gpu-mb-ctrl">
          {[15, 18, 20, 25].map((preset) => (
            <button
              key={preset}
              className={`gpu-mb-preset${marginPct === preset ? ' on' : ''}`}
              onClick={() => { setMarginInput(preset); handleMarginSave(preset) }}
            >
              {preset}%
            </button>
          ))}
          <div className="gpu-mb-input">
            <button onClick={() => { const v = Math.max(0, marginPct - 1); setMarginInput(v); handleMarginSave(v) }}>−</button>
            <input
              type="number"
              value={marginPct}
              onChange={(e) => setMarginInput(Number(e.target.value))}
              onBlur={() => handleMarginSave(marginPct)}
            />
            <span className="gpu-mb-pct">%</span>
            <button onClick={() => { const v = marginPct + 1; setMarginInput(v); handleMarginSave(v) }}>+</button>
          </div>
          {marginSaving && <span style={{ fontSize: '11px', color: 'var(--gpu-muted)' }}>저장 중…</span>}
        </div>
      </div>

      {/* Tier 범례 */}
      <div className="gpu-tier-legend">
        <span className="gpu-tl"><span className="gpu-badge gpu-badge-t1">Tier 1</span>전용 고성능 · 보장형</span>
        <span className="gpu-tl"><span className="gpu-badge gpu-badge-t2">Tier 2</span>점유형(예약 단독) · 보장형</span>
        <span className="gpu-tl"><span className="gpu-badge gpu-badge-t3">Tier 3</span>간헐 공급(중단/재개) · 최저가</span>
        <span className="gpu-tier-legend-note">
          <Info size={13} /> 최저가는 동일 모델·tier 안에서만 비교
        </span>
      </div>

      </div>{/* end 고정 헤더 */}

      {/* ── 스크롤 영역 (리스트만) ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      {/* 가격표 */}
      <div className="gpu-panel">
        <table className="gpu-table">
          <thead>
            <tr>
              <th
                onClick={() => handleSort('model')}
                style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              >
                GPU 모델<SortIcon col="model" sortConfig={sortConfig} />
              </th>
              <th
                onClick={() => handleSort('supply')}
                style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              >
                최저 공급가 <span className="gpu-th-note">(시간당 · {currencyMode === 'KRW' ? '원화' : '달러'})</span><SortIcon col="supply" sortConfig={sortConfig} />
              </th>
              <th>최저가 공급사</th>
              <th
                className="r"
                onClick={() => handleSort('sell')}
                style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              >
                gcube 판매가 <span className="gpu-th-note">(마진 적용 · {currencyMode === 'KRW' ? '원화' : '달러'})</span><SortIcon col="sell" sortConfig={sortConfig} />
              </th>
              <th>견적 상태</th>
              {selectedTier && (
                <th className="r" style={{ color: 'var(--gpu-accent)', whiteSpace: 'nowrap' }}>
                  {selectedTier.name} 할인가 <span className="gpu-th-note">({selectedTier.discount_rate}%↓)</span>
                </th>
              )}
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const tier = TIER_CONFIG[p.tier]
              const isExpanded = expandedId === p.id
              const sellKrw = computeSellKrw(p)
              const partnerKrw = computePartnerKrw(sellKrw)
              const dday = p.lowest_valid_until ? fmtDday(p.lowest_valid_until) : null
              const firstLetter = p.model_name.charAt(0)

              return [
                <tr
                  key={p.id}
                  id={`gpu-row-${p.id}`}
                  className={`gpu-row-main${isExpanded ? ' open' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                >
                  <td>
                    <div className="gpu-model-cell">
                      <div className="gpu-chip" style={{ background: tier.chipColor }}>
                        {firstLetter}
                        <span>{p.memory}</span>
                      </div>
                      <div>
                        <div className="gpu-model-nm">{p.model_name} <span style={{ fontSize: '11px', color: 'var(--gpu-muted)', fontWeight: 400 }}>×{p.gpu_count}GPU</span></div>
                        <div className="gpu-model-meta">
                          <span className={`gpu-badge ${tier.badge}`} style={{ fontSize: '10px' }}>{tier.label}</span>
                          {' '}{tier.name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {p.pricing_mode === 'direct' ? (
                      <div style={{ fontSize: '12px', color: 'var(--gpu-muted)' }}>견적 없음</div>
                    ) : p.lowest_unit_price_usd != null ? (
                      <>
                        <div className="gpu-price-main">
                          {currencyMode === 'KRW'
                            ? fmtKRW(Math.round(p.lowest_unit_price_usd * usdKrw))
                            : fmtUSD(p.lowest_unit_price_usd)}
                        </div>
                        <div className="gpu-price-sub">
                          {currencyMode === 'KRW'
                            ? <>{fmtUSD(p.lowest_unit_price_usd)} · /GPU·hr</>
                            : <>/GPU·hr · {fmtKRW(Math.round(p.lowest_unit_price_usd * usdKrw))}</>}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--gpu-faint)' }}>견적 대기</div>
                    )}
                  </td>
                  <td>
                    {p.pricing_mode === 'direct' ? (
                      <span style={{ fontSize: '12px', color: 'var(--gpu-muted)' }}>gcube 직접 설정</span>
                    ) : p.lowest_supplier ? (
                      <div className="gpu-supplier-tag">
                        <span className="gpu-sdot" style={{ background: p.lowest_supplier.color }} />
                        {p.lowest_supplier.name}
                      </div>
                    ) : p.lowest_unit_price_usd != null ? (
                      <span style={{ fontSize: '12px', color: 'var(--gpu-amber)' }}>공급사 미지정</span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--gpu-faint)' }}>—</span>
                    )}
                  </td>
                  <td className="r">
                    {sellKrw != null ? (
                      <>
                        <div className="gpu-price-main">
                          {currencyMode === 'KRW'
                            ? fmtKRW(sellKrw)
                            : fmtUSD(sellKrw / usdKrw)}
                        </div>
                        <div className="gpu-price-sub">
                          {currencyMode === 'KRW'
                            ? <>{fmtUSD(sellKrw / usdKrw)} · /hr</>
                            : <>/hr · {fmtKRW(sellKrw)}</>}
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--gpu-faint)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {p.pricing_mode === 'direct' ? (
                      <span className="gpu-badge gpu-badge-amber">직접입력</span>
                    ) : p.lowest_unit_price_usd != null ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span className="gpu-badge gpu-badge-green">견적 확정</span>
                        {dday && (
                          <span className="gpu-mono" style={{ fontSize: '10px', color: dday.color }}>{dday.label}</span>
                        )}
                      </div>
                    ) : p.pending_count > 0 ? (
                      <span className="gpu-badge gpu-badge-amber">검토 대기 {p.pending_count}건</span>
                    ) : (
                      <span className="gpu-badge gpu-badge-gray">견적 없음</span>
                    )}
                  </td>
                  {selectedTier && (
                    <td className="r">
                      {partnerKrw != null ? (
                        <>
                          <div className="gpu-price-main" style={{ color: 'var(--gpu-accent)' }}>
                            {currencyMode === 'KRW'
                              ? fmtKRW(partnerKrw)
                              : fmtUSD(partnerKrw / usdKrw)}
                          </div>
                          <div className="gpu-price-sub">
                            {currencyMode === 'KRW'
                              ? <>{fmtUSD(partnerKrw / usdKrw)} · /hr</>
                              : <>/hr · {fmtKRW(partnerKrw)}</>}
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--gpu-faint)' }}>—</span>
                      )}
                    </td>
                  )}
                  <td>
                    <ChevronRight
                      size={18}
                      className={`gpu-chev${isExpanded ? ' open' : ''}`}
                    />
                  </td>
                </tr>,
                isExpanded && (
                  <tr key={`${p.id}-expand`} className="gpu-detail-row">
                    <td colSpan={colCount} style={{ padding: 0 }}>
                      {p.pricing_mode === 'direct' ? (
                        <div className="gpu-expand-body gpu-expand-direct">
                          <Info size={13} />
                          <span>Tier 3 — 공급 견적 없음. 판매가는 직접 입력 방식으로 관리됩니다.</span>
                          {sellKrw && <strong className="gpu-mono">{fmtKRW(sellKrw)}/hr (현재가)</strong>}
                        </div>
                      ) : (
                        <ExpandedRow productId={p.id} usdKrw={usdKrw} marginPct={marginPct} currencyMode={currencyMode} />
                      )}
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
      <div className="gpu-empty-hint">
        행을 클릭하면 해당 모델의 <strong>전체 공급사 견적</strong>이 펼쳐지며, 각 견적의 근거자료를 바로 확인할 수 있습니다
      </div>
      </div>{/* end 스크롤 영역 */}
    </div>
  )
}
