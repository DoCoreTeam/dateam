'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { ChevronRight, Plus, Zap, Info, ArrowUpDown, ArrowUp, ArrowDown, Tag } from 'lucide-react'
import { formatSpec, scaleSpec } from '@/lib/gpu/format-spec'

type SortKey = 'model' | 'supply' | 'sell'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sortConfig }: { col: SortKey; sortConfig: { key: SortKey; dir: SortDir } | null }) {
  if (sortConfig?.key !== col) return <ArrowUpDown size={11} style={{ opacity: 0.35, flexShrink: 0 }} />
  return sortConfig.dir === 'asc'
    ? <ArrowUp size={11} style={{ color: 'var(--gpu-accent)', flexShrink: 0 }} />
    : <ArrowDown size={11} style={{ color: 'var(--gpu-accent)', flexShrink: 0 }} />
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
  vcpu?: number
  ram_gb?: number
  storage_gb?: number
  pricing_mode: 'quote' | 'direct'
  lowest_unit_price_usd: number | null
  lowest_supplier: Supplier | null
  lowest_valid_until: string | null
  sell_price_krw: number | null
  sell_price_usd: number | null
  pending_count: number
  is_propagated?: boolean
  per_gpu_usd?: number | null
  own_lowest_usd?: number | null
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

interface SupplierOpt { id: string; name: string; color: string }

function AssignSupplier({ quoteId, onAssigned }: { quoteId: string; onAssigned: () => void }) {
  const { data } = useSWR<{ suppliers: SupplierOpt[] }>('/api/pricing/gpu/suppliers', fetcher)
  const suppliers = data?.suppliers ?? []
  const [sel, setSel] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const assign = async () => {
    if (!sel) return
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: sel }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '지정 실패'); return }
      onAssigned()
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }} onClick={(e) => e.stopPropagation()}>
      <select
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        aria-label="공급사 지정"
        style={{ height: 26, fontSize: 11.5, borderRadius: 6, border: '1.5px solid var(--gpu-amber)', padding: '0 6px', maxWidth: 150 }}
      >
        <option value="">공급사 선택…</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button
        onClick={assign}
        disabled={!sel || saving}
        className="gpu-btn"
        style={{ height: 26, padding: '0 9px', fontSize: 11.5, fontWeight: 600, background: sel ? 'var(--gpu-accent, #5b5ef0)' : '#cbd5e1', color: '#fff', borderRadius: 6 }}
      >
        {saving ? '지정 중…' : '지정'}
      </button>
      {err && <span style={{ fontSize: 10.5, color: 'var(--gpu-red)' }}>{err}</span>}
    </div>
  )
}

function ExpandedRow({ productId, usdKrw, marginPct, currencyMode }: ExpandedRowProps) {
  const { data } = useSWR<{ quotes: Quote[] }>(
    `/api/pricing/gpu/quotes?product_id=${productId}`,
    fetcher
  )
  const { mutate } = useSWRConfig()
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {q.suppliers ? (
                  <span className="gpu-sdot" style={{ background: q.suppliers.color }} />
                ) : (
                  <span className="gpu-sdot" style={{ background: 'var(--gpu-amber)' }} />
                )}
                <span style={{ fontWeight: 600, color: q.suppliers ? undefined : 'var(--gpu-amber)' }}>
                  {q.suppliers?.name ?? '공급사 미지정'}
                </span>
                {isBest && <span className="gpu-badge-best">최저가</span>}
              </div>
              {!q.suppliers && (
                <AssignSupplier quoteId={q.id} onAssigned={() => { mutate(`/api/pricing/gpu/quotes?product_id=${productId}`); mutateGpu(mutate) }} />
              )}
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
  const [collapsedModels, setCollapsedModels] = useState<Set<string>>(new Set())
  const [collapsedTiers, setCollapsedTiers] = useState<Set<number>>(new Set())
  const [groupsInitialized, setGroupsInitialized] = useState(false)
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

  const products = data?.products ?? []

  // 모델 그룹 기본 접힘 — 최초 로드 시 전체 모델을 접힘 상태로 초기화
  useEffect(() => {
    if (groupsInitialized || products.length === 0) return
    setCollapsedModels(new Set(products.map((p) => p.model_name)))
    // Tier 1은 기본 펼침(모델은 접힘 유지), Tier 2·3만 접힘
    setCollapsedTiers(new Set(products.map((p) => p.tier).filter((t) => t !== 1)))
    setGroupsInitialized(true)
  }, [products, groupsInitialized])

  // 외부(시장비교·공급사)에서 특정 상품으로 탐색 진입 시: 그룹 초기화(전체 접힘) 이후에 실행되어야
  // 해당 Tier·모델 그룹을 펼치고 견적까지 열어 위치를 보여준다.
  useEffect(() => {
    if (!initialProductId || !groupsInitialized) return
    const prod = products.find((p) => p.id === initialProductId)
    if (prod) {
      setCollapsedTiers((prev) => { const n = new Set(prev); n.delete(prod.tier); return n })
      setCollapsedModels((prev) => { const n = new Set(prev); n.delete(prod.model_name); return n })
    }
    setExpandedId(initialProductId)
    onProductFocusConsumed?.()
    // scroll the row into view after render
    requestAnimationFrame(() => {
      const row = document.getElementById(`gpu-row-${initialProductId}`)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [initialProductId, groupsInitialized]) // eslint-disable-line react-hooks/exhaustive-deps

  const marginPct = marginInput ?? data?.margin_pct ?? 18
  const usdKrw = data?.usd_krw ?? 1400
  const fxDate = data?.fx_date

  // 항상 전체 상품 표시 (견적확정만/전체상품 구분 제거)
  const filtered = products.filter((p) => {
    if (tierFilter !== 0 && p.tier !== tierFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (p.model_name ?? '').toLowerCase().includes(q) || (p.memory ?? '').toLowerCase().includes(q)
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

  // ── 모델 그룹핑 + 수량 변형(x1/x4/x8) 자동 도출 ──
  // 같은 model_name을 그룹으로 묶고, quote 상품은 1장당 단가 기준으로 표준 구성(1/4/8)을 도출.
  const STD_CONFIGS = [1, 4, 8]
  type DisplayRow = GpuProduct & { _derived?: boolean }
  interface ModelGroup { model: string; tier: 1 | 2 | 3; perGpu: number | null; rows: DisplayRow[] }

  const modelGroups: ModelGroup[] = (() => {
    const byModel = new Map<string, GpuProduct[]>()
    for (const p of sorted) {
      const arr = byModel.get(p.model_name) ?? []
      arr.push(p); byModel.set(p.model_name, arr)
    }
    const groups: ModelGroup[] = []
    for (const [model, variants] of Array.from(byModel.entries())) {
      // 1장당 단가: gpu_count 가장 작은 견적 보유 변형에서 도출 (unit ÷ count)
      const priced = variants.filter((v) => v.lowest_unit_price_usd != null).sort((a, b) => a.gpu_count - b.gpu_count)
      const base = priced[0]
      const perGpu = base ? (base.lowest_unit_price_usd as number) / Math.max(base.gpu_count, 1) : null
      const existingCounts = new Set(variants.map((v) => v.gpu_count))
      const rows: DisplayRow[] = [...variants]
      // quote 상품이고 1장당 단가가 있으면 표준 구성 자동 도출(없는 것만)
      if (base && base.pricing_mode === 'quote' && perGpu != null) {
        for (const n of STD_CONFIGS) {
          if (existingCounts.has(n)) continue
          const sc = scaleSpec(base, n)
          rows.push({
            ...base,
            id: `${base.id}__x${n}`,
            gpu_count: n,
            vcpu: sc.vcpu ?? base.vcpu,
            ram_gb: sc.ram_gb ?? base.ram_gb,
            storage_gb: sc.storage_gb ?? base.storage_gb,
            lowest_unit_price_usd: Math.round(perGpu * n * 10000) / 10000,
            sell_price_krw: null,
            _derived: true,
          })
        }
      }
      rows.sort((a, b) => a.gpu_count - b.gpu_count)
      groups.push({ model, tier: variants[0].tier, perGpu, rows })
    }
    return groups
  })()

  function toggleModel(model: string) {
    setCollapsedModels((prev) => {
      const next = new Set(prev)
      if (next.has(model)) next.delete(model); else next.add(model)
      return next
    })
  }

  function toggleTier(tier: number) {
    setCollapsedTiers((prev) => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier); else next.add(tier)
      return next
    })
  }

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
          title="전체 필터 초기화"
          onClick={() => { setTierFilter(0) }}
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
          <button className="on" title="전체 상품 표시" style={{ cursor: 'default' }}>
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

      {/* Tier 안내 (설명 제거 — Tier 등급만) */}
      <div className="gpu-tier-legend">
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
                <span className="gpu-th-sort">GPU 모델<SortIcon col="model" sortConfig={sortConfig} /></span>
              </th>
              <th
                onClick={() => handleSort('supply')}
                style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              >
                <span className="gpu-th-sort">최저 공급가 <span className="gpu-th-note">(시간당 · {currencyMode === 'KRW' ? '원화' : '달러'})</span><SortIcon col="supply" sortConfig={sortConfig} /></span>
              </th>
              <th>최저가 공급사</th>
              <th
                className="r"
                onClick={() => handleSort('sell')}
                style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              >
                <span className="gpu-th-sort gpu-th-sort-r">gcube 판매가 <span className="gpu-th-note">(마진 적용 · {currencyMode === 'KRW' ? '원화' : '달러'})</span><SortIcon col="sell" sortConfig={sortConfig} /></span>
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
            {(() => {
              const byTier = new Map<number, typeof modelGroups>()
              for (const g of modelGroups) {
                if (!byTier.has(g.tier)) byTier.set(g.tier, [])
                byTier.get(g.tier)!.push(g)
              }
              const renderGroup = (group: (typeof modelGroups)[number]) => {
              const tierCfg = TIER_CONFIG[group.tier]
              const collapsed = collapsedModels.has(group.model)
              const groupHeader = (
                <tr key={`grp-${group.model}`} className="gpu-group-header" onClick={() => toggleModel(group.model)} style={{ cursor: 'pointer', background: '#fafbff' }}>
                  <td colSpan={colCount}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ChevronRight size={15} style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.15s', color: 'var(--gpu-muted)' }} />
                      <span className={`gpu-badge ${tierCfg.badge}`} style={{ fontSize: 10 }}>{tierCfg.label}</span>
                      <strong style={{ fontSize: 13.5, color: '#0f172a' }}>{group.model}</strong>
                      <span style={{ fontSize: 11, color: 'var(--gpu-muted)' }}>
                        {group.rows.length}개 구성{group.perGpu != null ? ` · 1장당 ${currencyMode === 'KRW' ? fmtKRW(Math.round(group.perGpu * usdKrw)) : fmtUSD(group.perGpu)}/GPU·hr` : ''}
                      </span>
                    </div>
                  </td>
                </tr>
              )
              if (collapsed) return [groupHeader]

              const memberRows = group.rows.flatMap((p) => {
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
                  onClick={() => !p._derived && setExpandedId(isExpanded ? null : p.id)}
                  style={p._derived ? { opacity: 0.92 } : undefined}
                >
                  <td>
                    <div className="gpu-model-cell">
                      <div className="gpu-chip" style={{ background: tier.chipColor }}>
                        {firstLetter}
                        <span>{p.memory}</span>
                      </div>
                      <div>
                        <div className="gpu-model-nm">{p.model_name} <span style={{ fontSize: '11px', color: 'var(--gpu-muted)', fontWeight: 400 }}>×{p.gpu_count}GPU</span>
                          {p._derived && <span style={{ fontSize: '10px', color: 'var(--gpu-accent)', marginLeft: 4, fontWeight: 600 }}>추정</span>}
                        </div>
                        <div className="gpu-model-meta">
                          <span className={`gpu-badge ${tier.badge}`} style={{ fontSize: '10px' }}>{tier.label}</span>
                        </div>
                        <div style={{ fontSize: '10.5px', color: 'var(--gpu-faint)', marginTop: 2 }}>{formatSpec(p)}</div>
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
                    {p._derived ? (
                      <span className="gpu-badge" style={{ background: '#eef2ff', color: 'var(--gpu-accent)' }}>1장당×{p.gpu_count} 추정</span>
                    ) : p.pricing_mode === 'direct' ? (
                      <span className="gpu-badge gpu-badge-amber">직접입력</span>
                    ) : p.lowest_unit_price_usd != null ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {p.is_propagated ? (
                          <span className="gpu-badge" style={{ background: '#eef2ff', color: 'var(--gpu-accent)' }} title="모델 최저 1장당 단가를 이 구성에 전파한 추정가">
                            1장당 전파(추정)
                          </span>
                        ) : (
                          <span className="gpu-badge gpu-badge-green">견적 확정</span>
                        )}
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
                    {!p._derived && (
                      <ChevronRight
                        size={18}
                        className={`gpu-chev${isExpanded ? ' open' : ''}`}
                      />
                    )}
                  </td>
                </tr>,
                (isExpanded && !p._derived) && (
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
              })
              return [groupHeader, ...memberRows]
              }
              return Array.from(byTier.keys()).sort((a, b) => a - b).flatMap((tier) => {
                const tierCollapsed = collapsedTiers.has(tier)
                const tcfg = TIER_CONFIG[tier as 1 | 2 | 3]
                const groups = byTier.get(tier)!
                const tierHeader = (
                  <tr key={`tier-${tier}`} className="gpu-group-header" onClick={() => toggleTier(tier)} style={{ cursor: 'pointer', background: '#f1f3f9' }}>
                    <td colSpan={colCount}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ChevronRight size={16} style={{ transform: tierCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.15s', color: 'var(--gpu-muted)' }} />
                        <strong style={{ fontSize: 13.5, color: '#0f172a' }}>{tcfg.label}</strong>
                        <span style={{ fontSize: 11.5, color: 'var(--gpu-muted)' }}>{groups.length}개 모델</span>
                      </div>
                    </td>
                  </tr>
                )
                if (tierCollapsed) return [tierHeader]
                return [tierHeader, ...groups.flatMap(renderGroup)]
              })
            })()}
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
