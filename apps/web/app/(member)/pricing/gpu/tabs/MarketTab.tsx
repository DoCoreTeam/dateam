'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { RefreshCw, TrendingUp, AlertTriangle, Plus, X, BarChart2, Target, FileText, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { formatSpec } from '@/lib/gpu/format-spec'
import { SupplierBadge } from '@/components/gpu/SupplierBadge'

type StratSortKey = 'model' | 'supply' | 'market' | 'target' | 'required' | 'gap'

function StratSortIcon({ col, sortKey, sortDir }: { col: StratSortKey; sortKey: StratSortKey; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== col) return <ArrowUpDown size={11} style={{ opacity: 0.35, flexShrink: 0 }} />
  return sortDir === 'asc'
    ? <ArrowUp size={11} style={{ color: 'var(--gpu-accent)', flexShrink: 0 }} />
    : <ArrowDown size={11} style={{ color: 'var(--gpu-accent)', flexShrink: 0 }} />
}

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
  product: { id: string; model_name: string; memory: string; tier: number; gpu_count?: number; vcpu?: number | null; ram_gb?: number | null; storage_gb?: number | null }
  competitor_sku: string
  pricing_model: string
  region: string | null
  price_usd: number | null
  hours_ago: number | null
  is_fresh: boolean
  confidence: number | null
  notes: string | null
}

interface SupplyHistory {
  sample_count: number
  min_usd: number
  p25_usd: number
  median_usd: number
  p75_usd: number
  max_usd: number
  is_active: boolean
}

interface Strategy {
  edge_pct_normal: number
  edge_pct_aggressive: number
  margin_pct: number
  concede_margin_pct: number
  is_overridden: boolean
}

interface ProductGroup {
  product: { id: string; model_name: string; memory: string; tier: number; gpu_count?: number; vcpu?: number | null; ram_gb?: number | null; storage_gb?: number | null }
  competitors: MarketEntry[]
  our_suppliers?: OurSupplier[]
  our_price_usd: number | null
  current_supply_usd: number | null
  market_min: number | null
  market_max: number | null
  market_median: number | null
  strategy: Strategy
  supply_history: SupplyHistory | null
}

interface OurSupplier {
  supplier_id: string | null
  name: string
  color: string
  per_gpu_usd: number
  unit_price_usd: number
  sell_price_usd: number
  is_ours: boolean
}

interface MarketData {
  competitors: Competitor[]
  products: ProductGroup[]
  usd_krw: number
  summary: {
    low_count: number
    mid_count: number
    high_count: number
    competitor_count: number
  }
}

interface Mapping {
  id: string
  competitor_id: string
  gpu_product_id: string
  competitor_sku: string
  pricing_model: string
  competitors: { id: string; name: string } | null
  gpu_products: { id: string; model_name: string; memory: string } | null
}

type CurrencyMode = 'KRW' | 'USD'

interface RefreshResult {
  urls_checked: number
  prices_updated: number
  message?: string
  results?: { url: string; competitor: string; prices_found: number; error?: string }[]
}

function makeFmt(mode: CurrencyMode, usdKrw: number) {
  return (usd: number) =>
    mode === 'KRW'
      ? `₩${Math.round(usd * usdKrw).toLocaleString('ko-KR')}`
      : `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const PRICING_MODEL_LABEL: Record<string, string> = {
  on_demand: 'On-Demand',
  reserved_1y: '1년 약정',
  reserved_3y: '3년 약정',
  spot: 'Spot',
  committed: '커밋',
}

const TIER_CONFIG: Record<number, { label: string; name: string; badge: string; chipColor: string }> = {
  1: { label: 'Tier 1', name: '전용 고성능', badge: 'gpu-badge-t1', chipColor: '#13151c' },
  2: { label: 'Tier 2', name: '점유형',     badge: 'gpu-badge-t2', chipColor: '#1e40af' },
  3: { label: 'Tier 3', name: '간헐 공급',   badge: 'gpu-badge-t3', chipColor: '#b45309' },
}

const COMP_GROUPS: Record<string, { label: string; short: string; types: string[] }> = {
  hyperscaler: { label: '하이퍼스케일러', short: '하이퍼', types: ['hyperscaler'] },
  specialist: { label: '전용 서비스', short: '전용', types: ['specialist'] },
  marketplace: { label: '마켓플레이스', short: '마켓', types: ['marketplace'] },
  domestic: { label: '국내', short: '국내', types: ['domestic'] },
}

const HISTORY_MIN_SAMPLES = 5

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

function PositionBar({ ourPrice, marketMin, marketMax, marketMedian, fmt }: {
  ourPrice: number | null; marketMin: number | null; marketMax: number | null; marketMedian: number | null
  fmt: (v: number) => string
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
        <span style={{ fontFamily: 'monospace' }}>{fmt(marketMin)}</span>
        <span style={{ fontFamily: 'monospace' }}>{fmt(marketMax)}</span>
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
          <span style={{ marginLeft: 6 }}>중앙값 <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt(marketMedian)}</span></span>
        )}
      </div>
    </div>
  )
}

// 시나리오 계산
function computeScenarios(p: ProductGroup) {
  const { strategy, current_supply_usd, market_min, supply_history } = p
  if (market_min == null || current_supply_usd == null) return null

  const scenarios = [
    { key: 'aggressive', name: '공격적 1등', edgePct: strategy.edge_pct_aggressive, marginPct: strategy.margin_pct },
    { key: 'normal', name: '무난한 1등', edgePct: strategy.edge_pct_normal, marginPct: strategy.margin_pct },
    { key: 'concede', name: '마진 양보', edgePct: strategy.edge_pct_normal, marginPct: strategy.concede_margin_pct },
  ]

  const useHistory = supply_history != null && supply_history.is_active && supply_history.sample_count >= HISTORY_MIN_SAMPLES

  return scenarios.map(s => {
    const targetSellUsd = market_min * (1 - s.edgePct / 100)
    const requiredSupplyUsd = targetSellUsd / (1 + s.marginPct / 100)
    const supplyChangePct = ((requiredSupplyUsd - current_supply_usd) / current_supply_usd) * 100

    let judge: 'ok' | 'warn' | 'bad' = 'ok'
    let basis: 'history' | 'ratio' = 'ratio'

    if (useHistory && supply_history) {
      basis = 'history'
      if (requiredSupplyUsd >= supply_history.p25_usd) judge = 'ok'
      else if (requiredSupplyUsd >= supply_history.min_usd) judge = 'warn'
      else judge = 'bad'
    } else {
      const drop = Math.abs(supplyChangePct)
      if (drop <= 15) judge = 'ok'
      else if (drop <= 25) judge = 'warn'
      else judge = 'bad'
    }

    return { ...s, targetSellUsd, requiredSupplyUsd, supplyChangePct, judge, basis }
  })
}

// 판정 라벨
function judgeLabel(j: string) {
  if (j === 'ok') return '✓ 현실적'
  if (j === 'warn') return '⚠ 도전적'
  return '✗ 어려움'
}

function judgeColor(j: string) {
  if (j === 'ok') return { bg: '#e6f7ee', color: '#15a35a' }
  if (j === 'warn') return { bg: '#fef3e2', color: '#d97706' }
  return { bg: '#fdebee', color: '#e0405a' }
}

// 분석 탭 컨텐츠
function AnalyzePanel({ p, activeGroups, fmt, onGoToPriceTable, onOpenAI }: {
  p: ProductGroup
  activeGroups: Set<string>
  fmt: (v: number) => string
  onGoToPriceTable?: (modelName: string, productId: string) => void
  onOpenAI?: (modelName: string, productId: string) => void
}) {
  // 최신 가격(나이 무관) 기준 — 신선도로 버리지 않음
  const pricedComps = p.competitors.filter(c => c.price_usd != null)
  const cheaperItems = pricedComps
    .filter(c => p.our_price_usd != null && c.price_usd! < p.our_price_usd)
    .sort((a, b) => (a.price_usd ?? 0) - (b.price_usd ?? 0))

  const allPricesWithOurs = [...pricedComps.map(c => c.price_usd as number)]
  if (p.our_price_usd != null) allPricesWithOurs.push(p.our_price_usd)
  allPricesWithOurs.sort((a, b) => a - b)
  const ourRank = p.our_price_usd != null ? allPricesWithOurs.indexOf(p.our_price_usd) + 1 : null

  const insight = cheaperItems.length > 0
    ? `${cheaperItems.length}곳이 우리보다 저렴 · 최저 ${cheaperItems[0].competitor.name} ${fmt(cheaperItems[0].price_usd!)} · 우리 ${ourRank}위/${allPricesWithOurs.length}곳`
    : pricedComps.length > 0
    ? `우리가 시장 최저가 · ${pricedComps.length}곳 중 1위`
    : '수집된 시장 가격 없음'

  // 경쟁사별 그룹핑
  const byComp: Record<string, MarketEntry[]> = {}
  const filteredComps = activeGroups.size > 0
    ? p.competitors.filter(c => {
        const type = c.competitor.type
        for (const [groupKey, group] of Object.entries(COMP_GROUPS)) {
          if (activeGroups.has(groupKey) && group.types.includes(type)) return true
        }
        return false
      })
    : p.competitors

  filteredComps.forEach(c => {
    const cid = c.competitor.id
    if (!byComp[cid]) byComp[cid] = []
    byComp[cid].push(c)
  })

  const pmOrder = ['on_demand', 'reserved_1y', 'reserved_3y', 'committed', 'spot']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 한줄 인사이트 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', background: '#f3f4f8', borderRadius: 9, fontSize: 12.5,
      }}>
        <span style={{ fontSize: 16 }}>🧠</span>
        <span>{insight}</span>
      </div>

      {/* 우리 공급사 (경쟁사와 같은 시장에 배지로 구분 표시) */}
      {(p.our_suppliers ?? []).length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--gpu-accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            우리 공급사 · 원가 / 판매가
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {(p.our_suppliers ?? []).map((s, i) => (
              <div key={i} style={{
                background: 'rgba(91,94,240,0.04)', border: '1.5px solid var(--gpu-accent, #5b5ef0)',
                borderRadius: 10, padding: '10px 12px', fontSize: 12,
              }}>
                <div style={{ marginBottom: 6 }}>
                  <SupplierBadge name={s.name} color={s.color} kind={s.name === 'gcube' ? 'self' : 'ours'} unassigned={s.supplier_id == null} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>원가</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{fmt(s.unit_price_usd)}</span>
                  <span style={{ fontSize: 10, color: 'var(--gpu-muted)', marginLeft: 4 }}>판매</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--gpu-accent)' }}>{fmt(s.sell_price_usd)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 경쟁사별 카드 그리드 */}
      <div style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        경쟁사별 가격 (전체 pricing_model)
      </div>
      {Object.keys(byComp).length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--gpu-faint)', padding: '12px 0' }}>해당 그룹의 경쟁사 데이터 없음</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {Object.entries(byComp)
            .sort(([, aItems], [, bItems]) => {
              const aMin = Math.min(...aItems.map(x => x.price_usd ?? Infinity))
              const bMin = Math.min(...bItems.map(x => x.price_usd ?? Infinity))
              if (!Number.isFinite(aMin) && !Number.isFinite(bMin)) return 0
              if (!Number.isFinite(aMin)) return 1
              if (!Number.isFinite(bMin)) return -1
              return aMin - bMin
            })
            .map(([, items]) => {
            const c = items[0].competitor
            items.sort((a, b) => pmOrder.indexOf(a.pricing_model) - pmOrder.indexOf(b.pricing_model))
            const firstDiff = p.our_price_usd != null && items[0].price_usd != null
              ? (items[0].price_usd - p.our_price_usd) / p.our_price_usd * 100 : null
            const cardBorder = firstDiff == null ? 'var(--gpu-border)'
              : firstDiff < -3 ? '#cfe7d8' : firstDiff > 3 ? '#f5d2d8' : 'var(--gpu-border)'
            const anyStale = items.every(x => !x.is_fresh)
            const lastH = Math.min(...items.map(x => x.hours_ago ?? 999))

            return (
              <div key={c.id} style={{
                background: '#fff', border: `1.5px solid ${cardBorder}`,
                borderRadius: 10, padding: '10px 12px', fontSize: 12,
                opacity: anyStale ? 0.7 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontWeight: 700 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                  {c.name}
                  <span style={{ fontSize: 9, color: 'var(--gpu-muted)', marginLeft: 'auto' }}>
                    {c.type} · {c.region}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--gpu-muted)', marginBottom: 6, fontFamily: 'monospace' }}>
                  {items[0].competitor_sku}
                </div>
                {items.map(x => {
                  const diff = p.our_price_usd != null && x.price_usd != null
                    ? (x.price_usd - p.our_price_usd) / p.our_price_usd * 100 : null
                  const vsCls = diff == null ? 'var(--gpu-muted)'
                    : diff < -3 ? 'var(--gpu-green)' : diff > 3 ? 'var(--gpu-red)' : 'var(--gpu-muted)'
                  const vsTxt = diff == null ? '' : diff < -3 ? `${diff.toFixed(0)}%` : diff > 3 ? `+${diff.toFixed(0)}%` : '≈'
                  return (
                    <div key={x.mapping_id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                        background: '#f0f1f4', color: 'var(--gpu-ink-2)',
                      }}>
                        {PRICING_MODEL_LABEL[x.pricing_model] ?? x.pricing_model}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>
                        {x.price_usd != null ? fmt(x.price_usd) : '—'}
                      </span>
                      {vsTxt && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: vsCls, fontFamily: 'monospace' }}>
                          {vsTxt}
                        </span>
                      )}
                    </div>
                  )
                })}
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #f1f2f6' }}>
                  <FreshnessDot hoursAgo={lastH === 999 ? null : lastH} maxHours={48} />
                  {anyStale && <span style={{ fontSize: 9, color: 'var(--gpu-red)', marginLeft: 6 }}>만료</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 액션 버튼 */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button className="gpu-btn" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
          onClick={e => { e.stopPropagation(); onOpenAI?.(p.product.model_name, p.product.id) }}>
          <BarChart2 size={12} />
          AI 조회로 심층 분석
        </button>
        <button className="gpu-btn" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
          onClick={e => { e.stopPropagation(); onGoToPriceTable?.(p.product.model_name, p.product.id) }}>
          <TrendingUp size={12} />
          가격표에서 보기
        </button>
      </div>
    </div>
  )
}

// 전략 탭 컨텐츠
function StrategyPanel({ p, fmt }: { p: ProductGroup; fmt: (v: number) => string }) {
  const [edgePct, setEdgePct] = useState(p.strategy.edge_pct_normal)
  const [marginPct, setMarginPct] = useState(p.strategy.margin_pct)
  const [selectedScenario, setSelectedScenario] = useState<string>('normal')
  const [cardSaved, setCardSaved] = useState(false)

  const { market_min, current_supply_usd, supply_history } = p
  if (market_min == null || current_supply_usd == null) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gpu-faint)' }}>
        <AlertTriangle size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
        <div style={{ fontSize: 13 }}>공급가 또는 시장 최저가 데이터가 필요합니다</div>
      </div>
    )
  }

  const useHistory = supply_history != null && supply_history.is_active && supply_history.sample_count >= HISTORY_MIN_SAMPLES

  // 커스텀 슬라이더 값으로 시나리오 계산
  const scenarios = [
    { key: 'aggressive', name: '공격적 1등', edgePct: p.strategy.edge_pct_aggressive, marginPct },
    { key: 'normal', name: '무난한 1등', edgePct, marginPct },
    { key: 'concede', name: '마진 양보', edgePct, marginPct: p.strategy.concede_margin_pct },
  ].map(s => {
    const targetSellUsd = market_min * (1 - s.edgePct / 100)
    const requiredSupplyUsd = targetSellUsd / (1 + s.marginPct / 100)
    const supplyChangePct = ((requiredSupplyUsd - current_supply_usd) / current_supply_usd) * 100
    let judge: 'ok' | 'warn' | 'bad' = 'ok'
    let basis: 'history' | 'ratio' = 'ratio'
    if (useHistory && supply_history) {
      basis = 'history'
      if (requiredSupplyUsd >= supply_history.p25_usd) judge = 'ok'
      else if (requiredSupplyUsd >= supply_history.min_usd) judge = 'warn'
      else judge = 'bad'
    } else {
      const drop = Math.abs(supplyChangePct)
      if (drop <= 15) judge = 'ok'
      else if (drop <= 25) judge = 'warn'
      else judge = 'bad'
    }
    return { ...s, targetSellUsd, requiredSupplyUsd, supplyChangePct, judge, basis }
  })

  const normalScn = scenarios.find(s => s.key === 'normal')!
  const gapAmount = current_supply_usd - normalScn.requiredSupplyUsd
  const gapPct = (gapAmount / current_supply_usd) * 100
  const isGapOk = gapAmount <= 0

  const handleGenerateCard = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCardSaved(true)
    setTimeout(() => setCardSaved(false), 3000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 가격 역산 흐름 3카드 */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
          🎯 1등이 되려면 — 가격 역산 (무난한 1등 기준)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* 카드 1: 시장 최저가 */}
          <div style={{
            flex: 1, minWidth: 120, padding: '12px 14px',
            background: 'linear-gradient(135deg,#eef0fe,#fff)',
            border: '1.5px solid #ddd9fb', borderRadius: 10,
          }}>
            <div style={{ fontSize: 10, color: 'var(--gpu-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>현재 시장 최저가</div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--gpu-accent)' }}>{fmt(market_min)}</div>
            <div style={{ fontSize: 10, color: 'var(--gpu-muted)', marginTop: 3 }}>경쟁사 최저</div>
          </div>
          <div style={{ color: 'var(--gpu-muted)', fontSize: 18, fontWeight: 700 }}>→</div>
          {/* 카드 2: 목표 판매가 */}
          <div style={{
            flex: 1, minWidth: 120, padding: '12px 14px',
            background: 'linear-gradient(135deg,#e6f7ee,#fff)',
            border: '1.5px solid #cfe7d8', borderRadius: 10,
          }}>
            <div style={{ fontSize: 10, color: 'var(--gpu-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>목표 1등 판매가</div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--gpu-green)' }}>{fmt(normalScn.targetSellUsd)}</div>
            <div style={{ fontSize: 10, color: 'var(--gpu-muted)', marginTop: 3 }}>시장 최저 −{edgePct}%</div>
          </div>
          <div style={{ color: 'var(--gpu-muted)', fontSize: 18, fontWeight: 700 }}>←</div>
          {/* 카드 3: 필요 공급가 */}
          <div style={{
            flex: 1, minWidth: 120, padding: '12px 14px',
            background: isGapOk ? 'linear-gradient(135deg,#e6f7ee,#fff)' : 'linear-gradient(135deg,#fef3e2,#fff)',
            border: `1.5px solid ${isGapOk ? '#cfe7d8' : '#f5d2a0'}`, borderRadius: 10,
          }}>
            <div style={{ fontSize: 10, color: 'var(--gpu-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>필요 공급가</div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: isGapOk ? 'var(--gpu-green)' : 'var(--gpu-amber)' }}>{fmt(normalScn.requiredSupplyUsd)}</div>
            <div style={{ fontSize: 10, color: 'var(--gpu-muted)', marginTop: 3 }}>÷ (1 + 마진 {marginPct}%)</div>
          </div>
        </div>

        {/* 갭 표시 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginTop: 10,
          background: isGapOk ? '#f3fbf6' : '#fef7ee',
          border: `1px solid ${isGapOk ? '#cfe7d8' : '#f5d2a0'}`, borderRadius: 9, fontSize: 12.5,
        }}>
          <span style={{ fontSize: 16 }}>{isGapOk ? '✓' : '⚠'}</span>
          <div style={{ flex: 1 }}>
            현재 공급가 <strong style={{ fontFamily: 'monospace' }}>{fmt(current_supply_usd)}</strong>
            {' · '}1등 위해 필요한 공급가 <strong style={{ fontFamily: 'monospace' }}>{fmt(normalScn.requiredSupplyUsd)}</strong>
            <br />
            <span style={{ fontSize: 11, color: isGapOk ? 'var(--gpu-green)' : 'var(--gpu-amber)' }}>
              {isGapOk
                ? '→ 이미 1등 가능한 공급가 보유. 현 마진 유지'
                : `→ 공급가를 ${fmt(gapAmount)} (${gapPct.toFixed(1)}%) 더 낮춰야 1등 가능`}
            </span>
          </div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: isGapOk ? 'var(--gpu-green)' : 'var(--gpu-amber)' }}>
            {isGapOk ? '+' : '−'}{fmt(Math.abs(gapAmount))}
          </div>
        </div>
      </div>

      {/* 전략 변수 슬라이더 */}
      <div style={{ background: '#fff', border: '1px solid var(--gpu-border)', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          ⚙ 전략 변수 — 모델별 조정
          {p.strategy.is_overridden ? (
            <span style={{ fontSize: 9, color: 'var(--gpu-amber)', background: '#fef3e2', padding: '2px 6px', borderRadius: 4 }}>모델별 설정 적용 중</span>
          ) : (
            <span style={{ fontSize: 9, color: 'var(--gpu-accent)', background: 'var(--gpu-accent-bg)', padding: '2px 6px', borderRadius: 4 }}>전역 기본값 사용 중</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 5 }}>
              <span style={{ color: 'var(--gpu-ink-2)', fontWeight: 600 }}>우위 마진 (시장 최저 대비)</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--gpu-accent)' }}>−{edgePct}%</span>
            </div>
            <input
              type="range" min={0} max={20} step={1} value={edgePct}
              onChange={e => { e.stopPropagation(); setEdgePct(Number(e.target.value)) }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', accentColor: 'var(--gpu-accent)' }}
            />
            <div style={{ fontSize: 10, color: 'var(--gpu-faint)', marginTop: 3 }}>클수록 1등 입지 강함, 공급가 압박 ↑</div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 5 }}>
              <span style={{ color: 'var(--gpu-ink-2)', fontWeight: 600 }}>gcube 마진</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--gpu-accent)' }}>{marginPct}%</span>
            </div>
            <input
              type="range" min={5} max={30} step={1} value={marginPct}
              onChange={e => { e.stopPropagation(); setMarginPct(Number(e.target.value)) }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', accentColor: 'var(--gpu-accent)' }}
            />
            <div style={{ fontSize: 10, color: 'var(--gpu-faint)', marginTop: 3 }}>줄이면 공급가 압박 줄지만 수익 감소</div>
          </div>
        </div>
      </div>

      {/* 시나리오 3종 */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
          시나리오 3가지 — 클릭으로 선택
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {scenarios.map(s => {
            const jc = judgeColor(s.judge)
            const isSelected = selectedScenario === s.key
            return (
              <div
                key={s.key}
                onClick={e => { e.stopPropagation(); setSelectedScenario(s.key) }}
                style={{
                  padding: '12px 14px', borderRadius: 10, cursor: 'pointer', transition: '.13s',
                  border: isSelected ? '2px solid var(--gpu-accent)' : '1.5px solid var(--gpu-border)',
                  background: isSelected ? 'var(--gpu-accent-bg)' : '#fff',
                  position: 'relative',
                }}
              >
                {isSelected && (
                  <div style={{
                    position: 'absolute', top: -6, right: 8, fontSize: 9, fontWeight: 700,
                    background: 'var(--gpu-accent)', color: '#fff', padding: '1px 7px', borderRadius: 10,
                  }}>선택됨</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{s.name}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: jc.bg, color: jc.color }}>
                    {judgeLabel(s.judge)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--gpu-muted)', marginBottom: 5 }}>우위 마진 <strong>−{s.edgePct}%</strong> · gcube 마진 <strong>{s.marginPct}%</strong></div>
                <div style={{ fontSize: 11, color: 'var(--gpu-ink-2)', marginBottom: 4 }}>
                  판매가 <strong style={{ fontFamily: 'monospace' }}>{fmt(s.targetSellUsd)}</strong>
                </div>
                <div style={{ fontSize: 11, marginBottom: 6 }}>
                  필요 공급가 <strong style={{ fontFamily: 'monospace', fontSize: 13, color: jc.color }}>{fmt(s.requiredSupplyUsd)}</strong>
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 600, fontFamily: 'monospace',
                  color: s.supplyChangePct < 0 ? 'var(--gpu-red)' : 'var(--gpu-green)',
                }}>
                  {s.supplyChangePct >= 0 ? '+' : ''}{s.supplyChangePct.toFixed(1)}% 변화 필요
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--gpu-faint)', marginTop: 5, borderTop: '1px solid #f1f2f6', paddingTop: 5 }}>
                  {s.basis === 'history' && supply_history
                    ? `이력 ${supply_history.sample_count}건 기반 (${fmt(supply_history.min_usd)}~${fmt(supply_history.max_usd)})`
                    : `비율 폴백 (인하 폭 ${Math.abs(s.supplyChangePct).toFixed(0)}%)`}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 판정 근거 박스 */}
      <div style={{
        padding: '10px 14px', background: '#fafbfc', border: '1px solid var(--gpu-border)',
        borderRadius: 9, fontSize: 11.5,
      }}>
        <strong>판정 근거</strong>{' '}
        {useHistory && supply_history ? (
          <>자체 거래 이력 <strong>{supply_history.sample_count}건</strong> · {fmt(supply_history.min_usd)} ~ {fmt(supply_history.max_usd)} (p25 {fmt(supply_history.p25_usd)} / 중앙 {fmt(supply_history.median_usd)})</>
        ) : (
          <>자체 이력 부족 ({supply_history?.sample_count ?? 0}건 {'<'} 임계 {HISTORY_MIN_SAMPLES}건) — 단순 비율 기반 판정</>
        )}
        <span style={{
          marginLeft: 8, fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
          background: useHistory ? '#e6f7ee' : '#fef3e2',
          color: useHistory ? 'var(--gpu-green)' : 'var(--gpu-amber)',
        }}>
          {useHistory ? '자체 이력' : '비율 폴백'}
        </span>
        {!useHistory && (
          <div style={{ fontSize: 10, color: 'var(--gpu-muted)', marginTop: 4 }}>
            → 자체 거래 이력이 {HISTORY_MIN_SAMPLES}건 이상 누적되면 이력 기반 판정으로 자동 전환됩니다
          </div>
        )}
      </div>

      {/* 협상 카드 생성 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
        background: 'linear-gradient(100deg,#eef0fe,#fff)', border: '1px solid #ddd9fb', borderRadius: 10,
      }}>
        <span style={{ fontSize: 20 }}>📋</span>
        <div style={{ flex: 1, fontSize: 12.5 }}>
          <strong>공급 협상 카드 생성</strong> — 선택된 시나리오({scenarios.find(s => s.key === selectedScenario)?.name})의 목표 공급가를 공급사에 제시할 PDF로 만듭니다.
          <span style={{ color: 'var(--gpu-muted)', marginLeft: 4 }}>Drive 저장 (본부장이 직접 발송)</span>
        </div>
        <button
          onClick={handleGenerateCard}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: cardSaved ? 'var(--gpu-green)' : 'var(--gpu-accent)',
            color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px',
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', transition: '.2s',
          }}
        >
          <FileText size={12} />
          {cardSaved ? '생성 완료 ✓' : '협상 카드 생성'}
        </button>
      </div>
    </div>
  )
}

// 1등 전략 전체 요약 뷰
function StrategyOverviewPanel({ products, fmt }: { products: ProductGroup[]; fmt: (v: number) => string }) {
  const [scenarioKey, setScenarioKey] = useState<'aggressive' | 'normal' | 'concede'>('normal')
  const [sortKey, setSortKey] = useState<StratSortKey>('model')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (k: StratSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }

  const SCENARIO_LABELS = {
    aggressive: '공격적 1등',
    normal: '무난한 1등',
    concede: '마진 양보',
  }

  const rows = products.map(p => {
    const scns = computeScenarios(p)
    if (!scns) return { p, scn: null }
    const scn = scns.find(s => s.key === scenarioKey) ?? scns[1]
    return { p, scn }
  })

  // 데이터 부족(scn=null) 행은 항상 하단으로, 나머지는 선택 컬럼 기준 정렬
  const sortedRows = [...rows].sort((a, b) => {
    if (!a.scn && !b.scn) return 0
    if (!a.scn) return 1
    if (!b.scn) return -1
    const dir = sortDir === 'asc' ? 1 : -1
    let cmp = 0
    switch (sortKey) {
      case 'model': cmp = a.p.product.model_name.localeCompare(b.p.product.model_name, 'ko'); break
      case 'supply': cmp = (a.p.current_supply_usd ?? Infinity) - (b.p.current_supply_usd ?? Infinity); break
      case 'market': cmp = (a.p.market_min ?? Infinity) - (b.p.market_min ?? Infinity); break
      case 'target': cmp = a.scn.targetSellUsd - b.scn.targetSellUsd; break
      case 'required': cmp = a.scn.requiredSupplyUsd - b.scn.requiredSupplyUsd; break
      case 'gap': {
        const ga = (a.p.current_supply_usd ?? 0) - a.scn.requiredSupplyUsd
        const gb = (b.p.current_supply_usd ?? 0) - b.scn.requiredSupplyUsd
        cmp = ga - gb
        break
      }
    }
    return cmp * dir
  })

  const hasAny = rows.some(r => r.scn != null)
  if (!hasAny) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--gpu-faint)' }}>
        <AlertTriangle size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
        <div style={{ fontSize: 13 }}>전략 계산에 필요한 공급가 또는 시장가 데이터가 없습니다</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 시나리오 선택 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 600 }}>시나리오:</span>
        {(Object.keys(SCENARIO_LABELS) as Array<keyof typeof SCENARIO_LABELS>).map(key => (
          <button
            key={key}
            onClick={() => setScenarioKey(key)}
            style={{
              padding: '5px 13px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: '.12s',
              border: `1.5px solid ${scenarioKey === key ? 'var(--gpu-accent)' : 'var(--gpu-border)'}`,
              background: scenarioKey === key ? 'var(--gpu-accent-bg)' : '#fff',
              color: scenarioKey === key ? 'var(--gpu-accent)' : 'var(--gpu-muted)',
            }}
          >
            {SCENARIO_LABELS[key]}
          </button>
        ))}
      </div>

      {/* 전략 요약 테이블 */}
      <div className="gpu-panel" style={{ overflow: 'hidden' }}>
        {/* 헤더 */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr 1.1fr',
          gap: 12, padding: '10px 18px',
          background: '#fafbfc', borderBottom: '1px solid var(--gpu-border)',
          fontSize: 10.5, color: 'var(--gpu-muted)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '.04em',
        }}>
          {([
            ['model', 'GPU 모델'],
            ['supply', '현재 공급가'],
            ['market', '시장 최저가'],
            ['target', '목표 판매가'],
            ['required', '필요 공급가'],
            ['gap', '갭 / 판정'],
          ] as [StratSortKey, string][]).map(([key, label]) => (
            <div
              key={key}
              onClick={() => handleSort(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                cursor: 'pointer', userSelect: 'none',
                color: sortKey === key ? 'var(--gpu-accent)' : undefined,
              }}
            >
              {label} <StratSortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
            </div>
          ))}
        </div>

        {sortedRows.map(({ p, scn }) => {
          const pid = p.product.id
          if (!scn) {
            return (
              <div key={pid} style={{
                display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr 1.1fr',
                gap: 12, padding: '12px 18px', alignItems: 'center',
                borderBottom: '1px solid #f1f2f6', opacity: 0.5,
              }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gpu-ink)' }}>{p.product.model_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--gpu-muted)', marginLeft: 6 }}>{p.product.memory}</span>
                  <div style={{ fontSize: 10.5, color: 'var(--gpu-faint)', marginTop: 2 }}>{formatSpec(p.product)}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--gpu-faint)', gridColumn: '2 / 7' }}>데이터 부족 — 공급가 또는 시장가 필요</div>
              </div>
            )
          }

          const jc = judgeColor(scn.judge)
          const gapAmount = (p.current_supply_usd ?? 0) - scn.requiredSupplyUsd
          const isGapOk = gapAmount <= 0

          return (
            <div key={pid} style={{
              display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr 1.1fr',
              gap: 12, padding: '13px 18px', alignItems: 'center',
              borderBottom: '1px solid #f1f2f6', transition: '.12s',
            }}>
              {/* 모델 */}
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gpu-ink)' }}>{p.product.model_name}</span>
                <span style={{ fontSize: 11, color: 'var(--gpu-muted)', marginLeft: 6 }}>{p.product.memory}</span>
                <div style={{ fontSize: 10.5, color: 'var(--gpu-faint)', marginTop: 2 }}>{formatSpec(p.product)}</div>
              </div>
              {/* 현재 공급가 */}
              <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--gpu-ink-2)' }}>
                {p.current_supply_usd != null ? fmt(p.current_supply_usd) : <span style={{ color: 'var(--gpu-faint)' }}>—</span>}
              </div>
              {/* 시장 최저가 */}
              <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--gpu-accent)' }}>
                {p.market_min != null ? fmt(p.market_min) : <span style={{ color: 'var(--gpu-faint)' }}>—</span>}
              </div>
              {/* 목표 판매가 */}
              <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--gpu-green)' }}>
                {fmt(scn.targetSellUsd)}
                <div style={{ fontSize: 10, fontFamily: 'sans-serif', color: 'var(--gpu-faint)', fontWeight: 400 }}>−{scn.edgePct}%</div>
              </div>
              {/* 필요 공급가 */}
              <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: jc.color }}>
                {fmt(scn.requiredSupplyUsd)}
                <div style={{ fontSize: 10, fontFamily: 'sans-serif', color: 'var(--gpu-faint)', fontWeight: 400 }}>마진 {scn.marginPct}%</div>
              </div>
              {/* 갭 + 판정 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 12.5, fontWeight: 700, color: isGapOk ? 'var(--gpu-green)' : 'var(--gpu-amber)' }}>
                  {isGapOk ? '▼' : '▲'}{fmt(Math.abs(gapAmount))}
                  <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 4 }}>({Math.abs(scn.supplyChangePct).toFixed(1)}%)</span>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: jc.bg, color: jc.color, alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>
                  {judgeLabel(scn.judge)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* 범례 */}
      <div style={{ fontSize: 11, color: 'var(--gpu-faint)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>▼ 현재 공급가가 낮아 추가 인하 여력 없음 (이미 가능)</span>
        <span>▲ 목표 공급가 달성까지 남은 인하 금액</span>
        <span>판정: ✓ 현실적(15% 이내) · ⚠ 도전적(25% 이내) · ✗ 어려움(25% 초과)</span>
      </div>
    </div>
  )
}

function PriceRegisterModal({
  mappings,
  onClose,
  onSaved,
}: {
  mappings: Mapping[]
  onClose: () => void
  onSaved: () => void
}) {
  useEscClose(onClose)
  const [mappingId, setMappingId] = useState(mappings[0]?.id ?? '')
  const [priceUsd, setPriceUsd] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const price = parseFloat(priceUsd)
    if (!mappingId || isNaN(price) || price <= 0) {
      setError('매핑과 가격(양수)을 입력하세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/pricing/gpu/market/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapping_id: mappingId,
          price_usd: price,
          source_url: sourceUrl || null,
          source_type: sourceUrl ? 'webpage' : 'manual',
          notes: notes || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error ?? 'Unknown error')
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, padding: '24px 28px', width: 460,
          boxShadow: '0 24px 64px rgba(16,22,40,.22)', display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--gpu-ink)' }}>경쟁사 가격 등록</div>
          <button type="button" onClick={onClose} className="gpu-btn" style={{ padding: '2px 6px' }}>
            <X size={14} />
          </button>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)', display: 'block', marginBottom: 5 }}>
            경쟁사 × 제품 매핑
          </label>
          <select
            value={mappingId}
            onChange={e => setMappingId(e.target.value)}
            className="gpu-input"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--gpu-border)', fontSize: 13 }}
          >
            {mappings.map(m => (
              <option key={m.id} value={m.id}>
                {m.competitors?.name ?? '?'} — {m.gpu_products?.model_name} {m.gpu_products?.memory} ({PRICING_MODEL_LABEL[m.pricing_model] ?? m.pricing_model})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)', display: 'block', marginBottom: 5 }}>
            출처 URL <span style={{ fontWeight: 400 }}>(경쟁사 가격 페이지)</span>
          </label>
          <input
            type="url"
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
            placeholder="https://www.runpod.io/pricing"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--gpu-border)', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)', display: 'block', marginBottom: 5 }}>
            관측 가격 (USD/GPU·hr) <span style={{ color: 'var(--gpu-red)' }}>*</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={priceUsd}
            onChange={e => setPriceUsd(e.target.value)}
            placeholder="예: 2.39"
            required
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--gpu-border)', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)', display: 'block', marginBottom: 5 }}>
            메모 (선택)
          </label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="예: 프로모션 가격, 인하 감지됨 등"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--gpu-border)', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--gpu-red)', background: '#fff3f4', padding: '8px 12px', borderRadius: 7 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="gpu-btn" disabled={saving}>취소</button>
          <button
            type="submit"
            disabled={saving}
            style={{
              background: 'var(--gpu-accent)', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 20px', fontWeight: 600, fontSize: 13,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .7 : 1,
            }}
          >
            {saving ? '저장 중…' : '가격 등록'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function MarketTab({ onGoToPriceTable, onOpenAI }: {
  onGoToPriceTable?: (modelName: string, productId: string) => void
  onOpenAI?: (modelName: string, productId: string) => void
}) {
  const { data, isLoading, mutate } = useSWR<MarketData>('/api/pricing/gpu/market', fetcher, {
    refreshInterval: 0,
  })
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('KRW')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedTab, setExpandedTab] = useState<Record<string, 'analyze' | 'strategy'>>({})
  const [activeComps, setActiveComps] = useState<Set<string>>(new Set())
  const [activeGroups, setActiveGroups] = useState<Set<string>>(new Set(Object.keys(COMP_GROUPS)))
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [showCompModal, setShowCompModal] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'strategy'>('table')
  const [positionFilter, setPositionFilter] = useState<null | 'low' | 'mid' | 'high'>(null)
  // Tier 카테고리 그룹 접힘 — Tier 1 기본 펼침, Tier 2·3 접힘(4개 메뉴 동일 UX)
  const [collapsedTiers, setCollapsedTiers] = useState<Set<number>>(new Set([2, 3]))
  const toggleTier = (t: number) => setCollapsedTiers(prev => {
    const next = new Set(prev)
    if (next.has(t)) next.delete(t); else next.add(t)
    return next
  })
  // 모델 하위그룹 접힘 — 기본 접힘(열린 모델만 Set에 보관). 4개 메뉴 동일 Tier→모델 구조.
  const [openModels, setOpenModels] = useState<Set<string>>(new Set())
  const toggleMarketModel = (key: string) => setOpenModels(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const usdKrw = data?.usd_krw ?? 1400
  const fmt = makeFmt(currencyMode, usdKrw)

  const { data: mappingsData } = useSWR<{ mappings: Mapping[] }>('/api/pricing/gpu/market/mappings', fetcher)

  const summary = data?.summary
  const products = data?.products ?? []
  const competitors = data?.competitors ?? []
  const mappings = mappingsData?.mappings ?? []

  const toggleComp = (id: string) => {
    setActiveComps(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (key: string) => {
    setActiveGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshResult(null)
    try {
      const res = await fetch('/api/pricing/gpu/market/refresh', { method: 'POST' })
      if (res.ok) {
        const result = await res.json() as RefreshResult
        setRefreshResult(result)
      }
    } catch {
      // 오류 시 DB 데이터만 새로고침
    }
    await mutate()
    setRefreshing(false)
  }

  const getExpandedTab = (pid: string) => expandedTab[pid] ?? 'analyze'

  const getProductPosition = (p: ProductGroup): 'low' | 'mid' | 'high' | null => {
    if (p.our_price_usd == null || p.market_median == null) return null
    if (p.our_price_usd < p.market_median * 0.9) return 'low'
    if (p.our_price_usd > p.market_median * 1.1) return 'high'
    return 'mid'
  }

  const filteredProducts = products
    .filter(p => positionFilter == null || getProductPosition(p) === positionFilter)
    .map(p => ({
      ...p,
      competitors: activeComps.size === 0
        ? p.competitors
        : p.competitors.filter(c => activeComps.has(c.competitor.id)),
    }))

  // Tier(1/2/3) 카테고리로 그룹핑 — 가격표와 동일 구조
  const tierGroups: { tier: number; products: typeof filteredProducts }[] = [1, 2, 3]
    .map(t => ({ tier: t, products: filteredProducts.filter(p => p.product.tier === t) }))
    .filter(g => g.products.length > 0)

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <div className="gpu-spinner" />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {showRegister && mappings.length > 0 && (
        <PriceRegisterModal
          mappings={mappings}
          onClose={() => setShowRegister(false)}
          onSaved={() => mutate()}
        />
      )}

      {/* ── 고정 헤더 ── */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 안내 배너 */}
      <div className="gpu-banner gpu-banner-market" style={{ marginBottom: 0 }}>
        <TrendingUp size={16} color="var(--gpu-accent)" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>경쟁사 시장 트랙</b> · 공급가·판매가와 독립된 차원에서 경쟁사 가격 추적 · <b>마지막 수집값 항상 표시</b>(신선도는 배지 참고)
          <span className="gpu-banner-sub"> · 수집 가격은 내부 의사결정용 — 외부 자료에 직접 인용 금지</span>
        </div>
        <div className="gpu-banner-actions">
          <div className="gpu-fx-pill" title="현재 적용 환율" style={{ fontSize: 11 }}>
            1 USD = <span className="gpu-mono">{Math.round(usdKrw).toLocaleString('ko-KR')}원</span>
          </div>
          <div className="gpu-seg">
            <button className={currencyMode === 'KRW' ? 'on' : ''} onClick={() => setCurrencyMode('KRW')}>₩ 원</button>
            <button className={currencyMode === 'USD' ? 'on' : ''} onClick={() => setCurrencyMode('USD')}>$ 달러</button>
          </div>
          <button
            className="gpu-btn"
            title="가격 등록"
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--gpu-accent)', color: '#fff', border: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
            onClick={() => setShowRegister(true)}
          >
            <Plus size={13} />
            <span className="gpu-btn-text-mob">가격 등록</span>
          </button>
          <button
            className="gpu-btn"
            title="새로고침"
            style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={12} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
            <span className="gpu-btn-text-mob">새로고침</span>
          </button>
        </div>
      </div>

      {/* AI 새로고침 결과 */}
      {refreshResult && (() => {
        const ok = refreshResult.prices_updated > 0
        const results = refreshResult.results ?? []
        const successUrls = results.filter(r => r.prices_found > 0).length
        const failUrls = results.filter(r => !!r.error).length
        return (
          <div style={{ background: ok ? 'var(--gpu-green-bg, #f0fdf4)' : 'var(--gpu-card-bg)', border: '1px solid', borderColor: ok ? 'var(--gpu-green, #22c55e)' : 'var(--gpu-border)', borderRadius: 8, fontSize: 13, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
              <RefreshCw size={13} color={ok ? '#16a34a' : 'var(--gpu-muted)'} />
              <span style={{ flex: 1 }}>
                {refreshResult.urls_checked === 0 ? (
                  <span style={{ color: 'var(--gpu-muted)' }}>{refreshResult.message ?? '분석할 URL이 없습니다 — 가격 등록 또는 경쟁사 URL 추가가 필요합니다'}</span>
                ) : (
                  <>
                    <b>{refreshResult.urls_checked}개 URL</b> AI 분석 ·{' '}
                    {ok
                      ? <><b style={{ color: '#16a34a' }}>{refreshResult.prices_updated}개 가격</b> 업데이트</>
                      : <span style={{ color: 'var(--gpu-muted)' }}>새 가격 없음</span>}
                    {results.length > 0 && (
                      <span style={{ color: 'var(--gpu-muted)', marginLeft: 6, fontSize: 12 }}>
                        (성공 {successUrls}{failUrls > 0 ? ` · 실패 ${failUrls}` : ''})
                      </span>
                    )}
                  </>
                )}
              </span>
              <button onClick={() => setRefreshResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gpu-muted)', padding: '2px 4px' }}>
                <X size={12} />
              </button>
            </div>
            {results.length > 0 && (
              <div style={{ borderTop: '1px solid var(--gpu-border)', maxHeight: 160, overflowY: 'auto' }}>
                {results.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', fontSize: 11.5, borderBottom: i < results.length - 1 ? '1px solid #f1f2f6' : 'none' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: r.error ? 'var(--gpu-red, #ef4444)' : r.prices_found > 0 ? 'var(--gpu-green, #22c55e)' : 'var(--gpu-muted)' }} />
                    <span style={{ fontWeight: 600, minWidth: 0, flexShrink: 0 }}>{r.competitor}</span>
                    <span style={{ color: 'var(--gpu-faint)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</span>
                    <span style={{ flexShrink: 0, color: r.error ? 'var(--gpu-red, #ef4444)' : r.prices_found > 0 ? '#16a34a' : 'var(--gpu-muted)' }}>
                      {r.error ? r.error : `${r.prices_found}건`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* 요약 통계 */}
      {summary && (
        <div className="responsive-grid-cols-4" style={{ gap: 12 }}>
          <div
            className={`gpu-stat-card gpu-stat-clickable${positionFilter === 'low' ? ' gpu-stat-card-active' : ''}`}
            title="저가 진영 모델만 보기"
            onClick={() => setPositionFilter(p => p === 'low' ? null : 'low')}
          >
            <div className="gpu-stat-label">저가 진영 모델</div>
            <div className="gpu-stat-value" style={{ color: 'var(--gpu-green)' }}>
              {summary.low_count}<span className="gpu-stat-unit">/{products.length}</span>
            </div>
            <div className="gpu-stat-sub">{positionFilter === 'low' ? '필터 적용 중 · 다시 클릭하면 해제' : '시장 하위 33% 안'}</div>
          </div>
          <div
            className={`gpu-stat-card gpu-stat-clickable${positionFilter === 'mid' ? ' gpu-stat-card-active' : ''}`}
            title="중간 진영 모델만 보기"
            onClick={() => setPositionFilter(p => p === 'mid' ? null : 'mid')}
          >
            <div className="gpu-stat-label">중간 진영</div>
            <div className="gpu-stat-value" style={{ color: 'var(--gpu-amber)' }}>
              {summary.mid_count}<span className="gpu-stat-unit">/{products.length}</span>
            </div>
            <div className="gpu-stat-sub">{positionFilter === 'mid' ? '필터 적용 중 · 다시 클릭하면 해제' : '중앙값 ±10% 이내'}</div>
          </div>
          <div
            className={`gpu-stat-card gpu-stat-clickable${positionFilter === 'high' ? ' gpu-stat-card-active' : ''}`}
            title="고가 진영 모델만 보기"
            onClick={() => setPositionFilter(p => p === 'high' ? null : 'high')}
          >
            <div className="gpu-stat-label">고가 진영</div>
            <div className="gpu-stat-value" style={{ color: 'var(--gpu-red)' }}>
              {summary.high_count}<span className="gpu-stat-unit">/{products.length}</span>
            </div>
            <div className="gpu-stat-sub">{positionFilter === 'high' ? '필터 적용 중 · 다시 클릭하면 해제' : '재가격 검토 권고'}</div>
          </div>
          <div
            className="gpu-stat-card gpu-stat-clickable"
            title="경쟁사 필터 열기"
            onClick={() => setShowCompModal(true)}
          >
            <div className="gpu-stat-label">활성 경쟁사</div>
            <div className="gpu-stat-value" style={{ color: 'var(--gpu-accent)' }}>
              {summary.competitor_count}<span className="gpu-stat-unit">곳</span>
            </div>
            <div className="gpu-stat-sub">클릭하면 경쟁사 필터</div>
          </div>
        </div>
      )}

      {/* 그룹 + 경쟁사 필터 */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px',
        background: '#fff', border: '1px solid var(--gpu-border)', borderRadius: 11, alignItems: 'center',
      }}>
        <span className="gpu-filter-label-mob" style={{ fontSize: 10.5, color: 'var(--gpu-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 2 }}>그룹:</span>
        {Object.entries(COMP_GROUPS).map(([key, group]) => (
          <button
            key={key}
            onClick={() => toggleGroup(key)}
            style={{
              padding: '4px 10px', borderRadius: 6, border: `1px solid ${activeGroups.has(key) ? 'var(--gpu-accent)' : 'var(--gpu-border)'}`,
              background: activeGroups.has(key) ? 'var(--gpu-accent-bg)' : '#fff',
              color: activeGroups.has(key) ? 'var(--gpu-accent)' : 'var(--gpu-muted)',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: '.12s',
            }}
          >
            <span className="desktop-only">{group.label}</span>
            <span className="mobile-only">{group.short}</span>
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: 'var(--gpu-border)', margin: '0 4px' }} />
        <span className="gpu-filter-label-mob" style={{ fontSize: 10.5, color: 'var(--gpu-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 2 }}>경쟁사:</span>
        <button
          onClick={() => setShowCompModal(true)}
          style={{
            padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6, transition: '.12s',
            border: activeComps.size > 0 ? '1px solid var(--gpu-accent)' : '1px solid var(--gpu-border)',
            background: activeComps.size > 0 ? 'var(--gpu-accent-bg)' : '#fff',
            color: activeComps.size > 0 ? 'var(--gpu-accent)' : 'var(--gpu-muted)',
          }}
        >
          {activeComps.size > 0 ? (
            <>
              {Array.from(activeComps).slice(0, 3).map(id => {
                const c = competitors.find(x => x.id === id)
                return c ? <span key={id} style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, display: 'inline-block' }} /> : null
              })}
              {activeComps.size > 3 && <span style={{ fontSize: 10 }}>+{activeComps.size - 3}</span>}
              {activeComps.size}개 선택
            </>
          ) : '전체 ▾'}
        </button>
        {activeComps.size > 0 && (
          <button
            onClick={() => setActiveComps(new Set())}
            style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--gpu-border)', background: '#fff', color: 'var(--gpu-muted)', fontSize: 11, cursor: 'pointer' }}
          >
            초기화
          </button>
        )}
      </div>
      </div>{/* end 고정 헤더 */}

      {/* ── 스크롤 영역 ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 12 }}>

      {/* 경쟁사 선택 모달 */}
      {showCompModal && (
        <div
          onClick={() => setShowCompModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 14, padding: '20px 24px', width: 400, maxWidth: '90vw',
              boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--gpu-ink)' }}>경쟁사 선택</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {activeComps.size > 0 && (
                  <button
                    onClick={() => setActiveComps(new Set())}
                    style={{ fontSize: 11, color: 'var(--gpu-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    전체 해제
                  </button>
                )}
                <button
                  onClick={() => setShowCompModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--gpu-muted)', display: 'flex' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(COMP_GROUPS).map(([groupKey, group]) => {
                const groupComps = competitors.filter(c => group.types.includes(c.type))
                if (groupComps.length === 0) return null
                return (
                  <div key={groupKey}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gpu-muted)', textTransform: 'uppercase', letterSpacing: '.06em', padding: '8px 4px 4px' }}>
                      {group.label}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {groupComps.map(c => (
                        <button
                          key={c.id}
                          onClick={() => toggleComp(c.id)}
                          style={{
                            padding: '5px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: '.12s',
                            border: activeComps.has(c.id) ? `1.5px solid ${c.color}` : '1px solid var(--gpu-border)',
                            background: activeComps.has(c.id) ? `${c.color}18` : '#fafafa',
                            color: activeComps.has(c.id) ? c.color : 'var(--gpu-ink)',
                            display: 'flex', alignItems: 'center', gap: 6,
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, display: 'inline-block', flexShrink: 0 }} />
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {/* 그룹 미분류 경쟁사 */}
              {(() => {
                const ungrouped = competitors.filter(c =>
                  !Object.values(COMP_GROUPS).some(g => g.types.includes(c.type))
                )
                if (ungrouped.length === 0) return null
                return (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gpu-muted)', textTransform: 'uppercase', letterSpacing: '.06em', padding: '8px 4px 4px' }}>기타</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {ungrouped.map(c => (
                        <button
                          key={c.id}
                          onClick={() => toggleComp(c.id)}
                          style={{
                            padding: '5px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: '.12s',
                            border: activeComps.has(c.id) ? `1.5px solid ${c.color}` : '1px solid var(--gpu-border)',
                            background: activeComps.has(c.id) ? `${c.color}18` : '#fafafa',
                            color: activeComps.has(c.id) ? c.color : 'var(--gpu-ink)',
                            display: 'flex', alignItems: 'center', gap: 6,
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, display: 'inline-block', flexShrink: 0 }} />
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
            <button
              onClick={() => setShowCompModal(false)}
              style={{
                marginTop: 18, width: '100%', padding: '10px', borderRadius: 8,
                background: 'var(--gpu-accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}
            >
              확인 {activeComps.size > 0 ? `(${activeComps.size}개 선택됨)` : '(전체)'}
            </button>
          </div>
        </div>
      )}

      {/* 모델별 시장 포지셔닝 매트릭스 */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gpu-ink)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {viewMode === 'table' ? '모델별 경쟁현황' : '전략적 금액 — 전체 요약'}
          {viewMode === 'table' && <span style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 500 }}>— 행 클릭 → 경쟁현황/전략적 금액 탭</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 0, border: '1.5px solid var(--gpu-border)', borderRadius: 8, overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('table')}
              style={{
                padding: '5px 13px', fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer', transition: '.12s',
                background: viewMode === 'table' ? 'var(--gpu-accent)' : '#fff',
                color: viewMode === 'table' ? '#fff' : 'var(--gpu-muted)',
              }}
            >
              <BarChart2 size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              <span className="desktop-only">경쟁현황</span>
              <span className="mobile-only">경쟁</span>
            </button>
            <button
              onClick={() => setViewMode('strategy')}
              style={{
                padding: '5px 13px', fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer', transition: '.12s',
                borderLeft: '1.5px solid var(--gpu-border)',
                background: viewMode === 'strategy' ? 'var(--gpu-accent)' : '#fff',
                color: viewMode === 'strategy' ? '#fff' : 'var(--gpu-muted)',
              }}
            >
              <Target size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              <span>전략적 금액</span>
            </button>
          </div>
        </div>

        {viewMode === 'strategy' ? (
          <StrategyOverviewPanel products={filteredProducts} fmt={fmt} />
        ) : null}

        <div className="gpu-panel" style={{ overflow: 'hidden', display: viewMode === 'table' ? undefined : 'none' }}>
          {/* 헤더 */}
          <div className="gpu-market-grid" style={{
            display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.5fr 36px',
            gap: 14, padding: '10px 18px',
            background: '#fafbfc', borderBottom: '1px solid var(--gpu-border)',
            fontSize: 10.5, color: 'var(--gpu-muted)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            <div>GPU 모델</div>
            <div>내 가격</div>
            <div className="gpu-market-col-hide">시장 범위</div>
            <div className="gpu-market-col-hide">포지셔닝</div>
            <div />
          </div>

          {filteredProducts.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--gpu-faint)' }}>
              <AlertTriangle size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
              <div style={{ fontSize: 13 }}>시장 데이터가 없습니다</div>
            </div>
          ) : (
            tierGroups.flatMap(g => {
              const gCfg = TIER_CONFIG[g.tier] ?? { label: `T${g.tier}`, name: '', badge: '', chipColor: '#666' }
              const gCollapsed = collapsedTiers.has(g.tier)
              const header = (
                <div
                  key={`tier-${g.tier}`}
                  onClick={() => toggleTier(g.tier)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', cursor: 'pointer', background: '#fafbff', borderBottom: '1px solid #f1f2f6', userSelect: 'none' }}
                >
                  <span style={{ transform: gCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform .15s', color: 'var(--gpu-muted)', display: 'inline-flex', fontSize: 11 }}>▶</span>
                  <strong style={{ fontSize: 13, color: '#0f172a' }}>{gCfg.label}</strong>
                  <span style={{ fontSize: 11, color: 'var(--gpu-muted)' }}>{new Set(g.products.map(p => p.product.model_name)).size}개 모델 · {g.products.length}개 구성</span>
                </div>
              )
              if (gCollapsed) return [header]
              const renderProductRow = (p: (typeof g.products)[number]) => {
              const pid = p.product.id
              const isOpen = expandedId === pid
              const tier = p.product.tier
              const tierCfg = TIER_CONFIG[tier] ?? { label: 'T?', name: '', badge: '', chipColor: '#666' }
              const currentTab = getExpandedTab(pid)

              const pricedComps = p.competitors.filter(c => c.price_usd != null)
              const allPrices = pricedComps.map(c => c.price_usd as number).sort((a, b) => a - b)
              const min = allPrices[0] ?? null
              const max = allPrices[allPrices.length - 1] ?? null

              // 전략 데이터 계산 여부
              const scns = computeScenarios(p)
              const hasStrategy = scns != null

              return (
                <div key={pid}>
                  {/* 메인 행 */}
                  <div
                    onClick={() => setExpandedId(isOpen ? null : pid)}
                    className="gpu-market-grid"
                    style={{
                      display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.5fr 36px',
                      gap: 14, padding: '14px 18px', alignItems: 'center',
                      cursor: 'pointer', transition: '.12s',
                      background: isOpen ? 'var(--gpu-accent-bg)' : '#fff',
                      borderBottom: '1px solid #f1f2f6',
                    }}
                    onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#fafbff' }}
                    onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#fff' }}
                  >
                    <div className="gpu-model-cell">
                      <div className="gpu-chip" style={{ background: tierCfg.chipColor }}>
                        {p.product.model_name.charAt(0)}
                        <span>{p.product.memory}</span>
                      </div>
                      <div>
                        <div className="gpu-model-nm">
                          {p.product.model_name}
                          {p.product.memory && !p.product.model_name.replace(/\s+/g, '').toLowerCase().includes(p.product.memory.toLowerCase()) && (
                            <span style={{ fontSize: '11px', color: 'var(--gpu-muted)', fontWeight: 400, marginLeft: 5 }}>{p.product.memory}</span>
                          )}
                        </div>
                        <div className="gpu-model-meta">
                          <span className={`gpu-badge ${tierCfg.badge}`} style={{ fontSize: '10px' }}>{tierCfg.label}</span>
                        </div>
                        <div style={{ fontSize: '10.5px', color: 'var(--gpu-faint)', marginTop: 2 }}>{formatSpec(p.product)}</div>
                      </div>
                    </div>

                    <div>
                      {p.our_price_usd != null ? (
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: 'var(--gpu-accent)' }}>
                          {fmt(p.our_price_usd)}<span style={{ fontSize: 10, color: 'var(--gpu-muted)', fontWeight: 400 }}>/hr</span>
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--gpu-faint)' }}>공급가 없음</span>
                      )}
                    </div>

                    <div className="gpu-market-col-hide">
                      {min != null && max != null ? (
                        <div>
                          <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12.5 }}>
                            {fmt(min)} ~ {fmt(max)}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--gpu-muted)', marginTop: 2 }}>
                            {pricedComps.length}개 경쟁사
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--gpu-faint)', fontStyle: 'italic' }}>—</span>
                      )}
                    </div>

                    <div className="gpu-market-col-hide">
                      <PositionBar
                        ourPrice={p.our_price_usd}
                        marketMin={p.market_min}
                        marketMax={p.market_max}
                        marketMedian={p.market_median}
                        fmt={fmt}
                      />
                    </div>

                    <div style={{ color: 'var(--gpu-faint)', transition: '.2s', transform: isOpen ? 'rotate(180deg)' : 'none', display: 'flex', justifyContent: 'center' }}>
                      ▼
                    </div>
                  </div>

                  {/* 펼침 영역 — 분석/전략 탭 */}
                  {isOpen && (
                    <div style={{ background: '#fbfcfe', borderBottom: '1px solid #f1f2f6' }}>
                      {/* 탭 헤더 */}
                      <div style={{
                        display: 'flex', gap: 0, padding: '0 18px',
                        borderBottom: '1px solid var(--gpu-border)',
                        background: '#fff',
                      }}>
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedTab(prev => ({ ...prev, [pid]: 'analyze' })) }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '10px 14px', fontSize: 12.5, fontWeight: 600,
                            border: 'none', background: 'none', cursor: 'pointer',
                            borderBottom: currentTab === 'analyze' ? '2px solid var(--gpu-accent)' : '2px solid transparent',
                            color: currentTab === 'analyze' ? 'var(--gpu-accent)' : 'var(--gpu-muted)',
                            transition: '.13s',
                          }}
                        >
                          <BarChart2 size={13} />
                          <span className="desktop-only">경쟁현황</span>
                          <span className="mobile-only">경쟁</span>
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedTab(prev => ({ ...prev, [pid]: 'strategy' })) }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '10px 14px', fontSize: 12.5, fontWeight: 600,
                            border: 'none', background: 'none', cursor: 'pointer',
                            borderBottom: currentTab === 'strategy' ? '2px solid var(--gpu-accent)' : '2px solid transparent',
                            color: currentTab === 'strategy' ? 'var(--gpu-accent)' : 'var(--gpu-muted)',
                            transition: '.13s',
                          }}
                        >
                          <Target size={13} />
                          <span className="desktop-only">전략적 금액</span>
                          <span className="mobile-only">금액</span>
                          {hasStrategy && (() => {
                            const scn = computeScenarios(p)
                            const recommended = scn?.find(s => s.judge === 'ok') || scn?.find(s => s.judge === 'warn') || scn?.[0]
                            return recommended ? (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: 'var(--gpu-accent-bg)', color: 'var(--gpu-accent)' }}>
                                {recommended.name}
                              </span>
                            ) : null
                          })()}
                        </button>
                      </div>

                      {/* 탭 패널 */}
                      <div style={{ padding: '14px 18px 18px' }}>
                        {currentTab === 'analyze' && (
                          <AnalyzePanel p={p} activeGroups={activeGroups} onGoToPriceTable={(name, id) => onGoToPriceTable?.(name, id)} onOpenAI={(name, id) => onOpenAI?.(name, id)} fmt={fmt} />
                        )}
                        {currentTab === 'strategy' && (
                          <StrategyPanel p={p} fmt={fmt} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
              }
              // Tier 안에서 모델로 한 번 더 그룹 (B200의 ×1/×2/×4/×8을 한 모델로 묶음)
              const byModel = new Map<string, typeof g.products>()
              for (const p of g.products) {
                const m = p.product.model_name
                if (!byModel.has(m)) byModel.set(m, [])
                byModel.get(m)!.push(p)
              }
              const modelEls = Array.from(byModel.keys()).sort((a, b) => a.localeCompare(b, 'ko')).flatMap(model => {
                const prods = byModel.get(model)!
                const mKey = `${g.tier}:${model}`
                const mOpen = openModels.has(mKey)
                const modelHeader = (
                  <div
                    key={`m-${mKey}`}
                    onClick={() => toggleMarketModel(mKey)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 18px 7px 30px', cursor: 'pointer', background: '#fff', borderBottom: '1px solid #f4f5f9', userSelect: 'none' }}
                  >
                    <span style={{ transform: mOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: 'var(--gpu-muted)', display: 'inline-flex', fontSize: 10 }}>▶</span>
                    <span className={`gpu-badge ${gCfg.badge}`} style={{ fontSize: 9.5 }}>T{g.tier}</span>
                    <strong style={{ fontSize: 12.5, color: '#111827' }}>{model}</strong>
                    <span style={{ fontSize: 11, color: 'var(--gpu-muted)' }}>{prods.length}개 구성</span>
                  </div>
                )
                if (!mOpen) return [modelHeader]
                return [modelHeader, ...prods.map(renderProductRow)]
              })
              return [header, ...modelEls]
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
        외부 자료(제안서·홈페이지)에 직접 인용 금지 · 가격은 <b style={{ color: 'var(--gpu-ink-2)' }}>마지막 수집값을 항상 표시</b>(수집 시점은 신선도 배지로 확인)
      </div>
      </div>{/* end 스크롤 영역 */}
    </div>
  )
}
