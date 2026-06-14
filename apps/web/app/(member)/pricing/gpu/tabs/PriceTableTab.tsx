'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { ChevronRight, Plus, Zap, Info, Tag, X, Trash2, Pencil } from 'lucide-react'
import { formatSpec, scaleSpec } from '@/lib/gpu/format-spec'
import { STANDARD_LADDER } from '@/lib/gpu/config-ladder'
import { fmtKRW, fmtUSD } from '@/lib/gpu/format-price'
import dynamic from 'next/dynamic'
import { GpuModelName } from '@/components/pricing/gpu/GpuModelName'
import { SortIcon } from '@/components/pricing/gpu/SortIcon'
import { buildTierModelGroups, tierKey, modelKey } from '@/lib/gpu/group'
import { GPU_TERMS } from '@/lib/gpu/terms'
import { useCollapsibleGroups } from '@/hooks/useCollapsibleGroups'

const ProductAddModal = dynamic(() => import('@/components/pricing/gpu/ProductAddModal'), { ssr: false })
const ProductEditModal = dynamic(() => import('@/components/pricing/gpu/ProductEditModal'), { ssr: false })
const QuoteEditModal = dynamic(() => import('@/components/pricing/gpu/QuoteEditModal'), { ssr: false })

type SortKey = 'model' | 'supply' | 'sell'
type SortDir = 'asc' | 'desc'

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
  series?: string | null
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
  basis?: 'selected' | 'auto' | 'fallback' | 'list' | 'none'
  selected_supplier?: Supplier | null
  fallback_reason?: string | null
  /** products API의 effective_supplier — 전파 근거 공급사명 표시용 */
  effective_supplier?: Supplier | string | null
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
  gpu_count: number
  term: string | null
  min_qty: string | null
  valid_until: string | null
  source_format: string | null
  ai_confidence: number | null
  price_type: 'cost' | 'list' | null
  is_selected: boolean | null
  suppliers: Supplier | null
}

const TIER_CONFIG = {
  1: { label: 'Tier 1', name: '전용 고성능', badge: 'gpu-badge-t1', chipColor: 'var(--text)' },
  2: { label: 'Tier 2', name: '점유형',     badge: 'gpu-badge-t2', chipColor: 'var(--info)' },
  3: { label: 'Tier 3', name: '간헐 공급',   badge: 'gpu-badge-t3', chipColor: 'var(--warning)' },
}

const fmtDday = (dateStr: string) => {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (diff < 0) return { label: '만료', color: 'var(--gpu-red)' }
  if (diff <= 7) return { label: `D-${diff}`, color: 'var(--gpu-amber)' }
  return { label: `D-${diff}`, color: 'var(--gpu-green)' }
}

// ── 파생(_derived) 추정 행 펼침 — 전파 근거 섹션 ──────────────────

interface DerivedPropagatedSectionProps {
  p: GpuProduct & { _derived?: boolean }
  usdKrw: number
  currencyMode: 'KRW' | 'USD'
}

function DerivedPropagatedSection({ p, usdKrw, currencyMode }: DerivedPropagatedSectionProps) {
  const perGpuUsd = p.per_gpu_usd ?? (
    p.lowest_unit_price_usd != null
      ? p.lowest_unit_price_usd / Math.max(p.gpu_count, 1)
      : null
  )
  const effectiveName = p.effective_supplier
    ? (typeof p.effective_supplier === 'string' ? p.effective_supplier : (p.effective_supplier as { name?: string }).name ?? '공급사 미지정')
    : p.lowest_supplier?.name ?? '공급사 미지정'
  const totalUsd = perGpuUsd != null ? perGpuUsd * p.gpu_count : null
  const totalKrw = totalUsd != null ? Math.round(totalUsd * usdKrw) : null

  return (
    <div className="gpu-expand-body cockpit-propagated-basis">
      <div className="cockpit-propagated-basis-title">
        <Info size={13} />
        1장당 전파(추정) 근거
      </div>
      {perGpuUsd != null ? (
        <>
          <div className="cockpit-propagated-basis-formula">
            {effectiveName} {currencyMode === 'KRW' ? fmtKRW(Math.round(perGpuUsd * usdKrw)) : fmtUSD(perGpuUsd)}/GPU
            {' '}×{' '}
            {p.gpu_count}GPU
            {' '}={' '}
            {totalKrw != null
              ? (currencyMode === 'KRW' ? fmtKRW(totalKrw) : fmtUSD(totalUsd!))
              : '—'}
            {' '}(추정)
          </div>
          <div className="cockpit-propagated-basis-note">
            이 구성에 직접 등록된 견적이 없습니다. 동일 모델 최저 1GPU 단가를 수량만큼 환산한 추정값입니다.
            실제 공급가는 견적 등록 탭에서 확인하세요.
          </div>
        </>
      ) : (
        <div className="cockpit-propagated-basis-note">
          이 구성에 직접 등록된 견적이 없습니다. 견적 등록 탭에서 공급 견적을 등록해 주세요.
        </div>
      )}
    </div>
  )
}

interface ExpandedRowProps {
  productId: string
  usdKrw: number
  marginPct: number
  currencyMode: 'KRW' | 'USD'
  /** 전파(추정) 원가 정보 — 실제 견적 없을 때 폴백 표시용 */
  propagated?: {
    per_gpu_usd: number
    gpu_count: number
    effective_supplier: { name: string; color: string } | null
  } | null
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
        style={{ height: 26, padding: '0 9px', fontSize: 11.5, fontWeight: 600, background: sel ? 'var(--gpu-accent, var(--brand))' : 'var(--border-subtle)', color: '#fff', borderRadius: 6 }}
      >
        {saving ? '지정 중…' : '지정'}
      </button>
      {err && <span style={{ fontSize: 10.5, color: 'var(--gpu-red)' }}>{err}</span>}
    </div>
  )
}

function ExpandedRow({ productId, usdKrw, marginPct, currencyMode, propagated }: ExpandedRowProps) {
  const { data } = useSWR<{ quotes: Quote[] }>(
    `/api/pricing/gpu/quotes?product_id=${productId}`,
    fetcher
  )
  const { mutate } = useSWRConfig()
  const [selecting, setSelecting] = useState<string | null>(null)
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null)
  const quotes = data?.quotes ?? []
  const costQuotes = quotes.filter((q) => q.price_type !== 'list')
  const listQuotes = quotes.filter((q) => q.price_type === 'list')
  const hasSelected = costQuotes.some((q) => q.is_selected)

  // 공시 판매가(gcube 등) 박스 — cost 견적 유무와 무관하게 항상 표시 (공통)
  const listBox = listQuotes.length > 0 ? (
    <div className="gpu-list-price-box">
      <div className="gpu-list-price-header">
        <span>📢</span>
        <span className="gpu-list-price-title">{GPU_TERMS.gcubeListPrice}</span>
        <span className="gpu-list-price-badge">매입원가 없음 · 게시가 그대로</span>
      </div>
      {listQuotes.map((q) => {
        const listKrw = Math.round(q.unit_price_usd * usdKrw)
        return (
          <div key={q.id} className="gpu-list-price-row">
            {q.suppliers && <span className="gpu-sdot" style={{ background: q.suppliers.color, width: 9, height: 9 }} />}
            <span className="gpu-list-price-name">{q.suppliers?.name ?? '—'}</span>
            <span className="gpu-list-price-label">{GPU_TERMS.gcubeListPrice}</span>
            <span className="gpu-list-price-val">
              {currencyMode === 'KRW' ? fmtKRW(listKrw) : fmtUSD(q.unit_price_usd)}
            </span>
            <span className="gpu-list-price-unit">/GPU·hr</span>
          </div>
        )
      })}
    </div>
  ) : null

  const toggleSelect = async (qid: string, next: boolean) => {
    setSelecting(qid)
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${qid}/select`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected: next }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? '채택 실패'); return }
      mutate(`/api/pricing/gpu/quotes?product_id=${productId}`); mutateGpu(mutate)
    } finally { setSelecting(null) }
  }

  // 직접 등록된 공급원가(cost) 견적이 없을 때 — 전파(추정) 근거 + 공시가 표시.
  // (gcube 공시 list 견적만 있는 ×2/×4 파생 구성도 ×1처럼 공급사 내용이 나와야 함)
  if (costQuotes.length === 0) {
    // buildCatalog 전파원가가 있으면 추정 근거(전파 기준 공급사) 표시
    if (propagated) {
      const estimatedUsd = propagated.per_gpu_usd * propagated.gpu_count
      const estimatedKrw = Math.round(estimatedUsd * usdKrw)
      const sellKrw = Math.round(estimatedUsd * (1 + marginPct / 100) * usdKrw)
      return (
        <div className="gpu-expand-body">
          <div className="gpu-expand-head gpu-expand-head--accent">
            <Info size={13} /> 전파 추정 원가 — 1장당 견적 환산
          </div>
          <div className="gpu-expand-desc">
            이 구성(×{propagated.gpu_count}GPU)에 직접 등록된 견적이 없습니다.
            동일 모델의 1장당 최저 단가({currencyMode === 'KRW' ? fmtKRW(Math.round(propagated.per_gpu_usd * usdKrw)) : fmtUSD(propagated.per_gpu_usd)}/GPU·hr)를
            {propagated.gpu_count}배로 환산한 <strong>추정값</strong>이며, 아래 공급사가 그 기준입니다.
          </div>
          <div className="gpu-qline gpu-qline-best gpu-qline--selected">
            <div className="gpu-qline-sup">
              {propagated.effective_supplier ? (
                <span className="gpu-sdot" style={{ background: propagated.effective_supplier.color }} />
              ) : (
                <span className="gpu-sdot" style={{ background: 'var(--gpu-accent)' }} />
              )}
              <span className="gpu-sup-name--accent">
                {propagated.effective_supplier?.name ?? '공급사 미지정'}
              </span>
              <span className="gpu-badge-propagated">
                추정 (전파)
              </span>
            </div>
            <div>
              <div className="gpu-mono gpu-price-main--accent">
                {currencyMode === 'KRW' ? fmtKRW(estimatedKrw) : fmtUSD(estimatedUsd)}
                <span className="gpu-price-unit">/GPU·hr</span>
              </div>
              <div className="gpu-price-sub">
                {currencyMode === 'KRW'
                  ? <>{fmtUSD(estimatedUsd)} · 추정 판매 {fmtKRW(sellKrw)}/hr</>
                  : <>추정 판매 {fmtUSD(sellKrw / usdKrw)}/hr · {fmtKRW(sellKrw)}</>}
              </div>
            </div>
            <div className="gpu-cell-faint">—</div>
            <div className="gpu-cell-faint">—</div>
            <div></div>
            <div></div>
          </div>
          {listBox}
        </div>
      )
    }
    return (
      <div className="gpu-expand-body">
        <div className="gpu-expand-empty">
          확정된 견적이 없습니다 — 견적 등록 탭에서 공급 견적을 등록해 주세요.
        </div>
        {listBox}
      </div>
    )
  }

  return (
    <div className="gpu-expand-body">
      <div className="gpu-expand-head">
        <Info size={13} /> 공급원가 비교 (낮은 순)
      </div>
      {costQuotes.map((q, i) => {
        const sellKrw = q.unit_price_usd * (1 + marginPct / 100) * usdKrw
        const dday = q.valid_until ? fmtDday(q.valid_until) : null
        const isBest = i === 0
        const isSelected = !!q.is_selected
        const isBasis = isSelected || (!hasSelected && isBest)
        return (
          <div key={q.id} className={`gpu-qline${isBasis ? ' gpu-qline-best' : ''}${isSelected ? ' gpu-qline--selected' : ''}`}>
            <div className="gpu-qline-sup">
              <div>
                {q.suppliers ? (
                  <span className="gpu-sdot" style={{ background: q.suppliers.color }} />
                ) : (
                  <span className="gpu-sdot" style={{ background: 'var(--gpu-amber)' }} />
                )}
                <span className={q.suppliers ? 'gpu-sup-name' : 'gpu-sup-name--unassigned'}>
                  {q.suppliers?.name ?? '공급사 미지정'}
                </span>
                {isBest && <span className="gpu-badge-best">최저가</span>}
                {isSelected ? (
                  <span className="gpu-badge-selected">
                    ✓ 판매가 기준
                  </span>
                ) : (!hasSelected && isBest) ? (
                  <span className="gpu-badge-auto-basis">
                    자동 기준
                  </span>
                ) : null}
                {q.suppliers && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(q.id, !isSelected) }}
                      disabled={selecting === q.id}
                      className={`gpu-btn-select${isSelected ? ' gpu-btn-select--active' : ''}`}>
                      {selecting === q.id ? '…' : isSelected ? '기준 해제' : '기준으로 선택'}
                    </button>
                    {!isSelected && (
                      <span className="cockpit-basis-hint">
                        기준선택 = 판매가 계산 기준 원가. 최종 판매가는 &lsquo;가격 결정&rsquo; 탭에서 지정.
                      </span>
                    )}
                  </>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingQuote(q) }}
                  title="견적 수정"
                  aria-label="견적 수정"
                  className="gpu-btn-edit">
                  <Pencil size={10} /> 수정
                </button>
              </div>
              {!q.suppliers && (
                <AssignSupplier quoteId={q.id} onAssigned={() => { mutate(`/api/pricing/gpu/quotes?product_id=${productId}`); mutateGpu(mutate) }} />
              )}
            </div>
            <div>
              <div className="gpu-mono gpu-price-main">
                {currencyMode === 'KRW' ? fmtKRW(Math.round(q.unit_price_usd * usdKrw)) : fmtUSD(q.unit_price_usd)}
                <span className="gpu-price-unit">/GPU·hr</span>
              </div>
              <div className="gpu-price-sub">
                {currencyMode === 'KRW'
                  ? <>{fmtUSD(q.unit_price_usd)} · 판매 {fmtKRW(sellKrw)}/hr</>
                  : <>판매 {fmtUSD(sellKrw / usdKrw)}/hr · {fmtKRW(sellKrw)}</>}
              </div>
            </div>
            <div className="gpu-cell-muted">{q.term ?? '—'}</div>
            <div className="gpu-cell-muted">{q.min_qty ?? '—'}</div>
            <div>
              {dday && (
                <span className="gpu-mono gpu-dday" style={{ color: dday.color }}>
                  {dday.label}
                </span>
              )}
              {q.valid_until && (
                <div className="gpu-cell-faint">{q.valid_until}</div>
              )}
            </div>
            <div className="gpu-cell-faint">
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
      {editingQuote && (
        <QuoteEditModal
          quote={{ ...editingQuote, supplier_name: editingQuote.suppliers?.name ?? null }}
          productId={productId}
          onClose={() => setEditingQuote(null)}
          onSaved={() => { mutate(`/api/pricing/gpu/quotes?product_id=${productId}`); mutateGpu(mutate) }}
        />
      )}
      {listBox}
    </div>
  )
}

// 파트너 등급(partner_tiers) 관리 모달 — 목록/추가/수정/삭제 (CRUD)
function PartnerTierManagerModal({ tiers, onClose, onChanged }: { tiers: PartnerTier[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const add = async () => {
    if (!name.trim() || !rate) { setErr('등급명·할인율 입력'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/pricing/gpu/partner-tiers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), discount_rate: Number(rate) }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '추가 실패'); return }
      setName(''); setRate(''); onChanged()
    } finally { setBusy(false) }
  }
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/pricing/gpu/partner-tiers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) onChanged(); else alert('수정 실패')
  }
  const del = async (id: string, nm: string) => {
    if (!confirm(`'${nm}' 등급을 삭제할까요?`)) return
    const res = await fetch(`/api/pricing/gpu/partner-tiers/${id}`, { method: 'DELETE' })
    if (res.ok) onChanged(); else alert('삭제 실패')
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(480px,100%)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: 'var(--hairline) solid var(--gpu-border)' }}>
          <strong style={{ fontSize: 15, flex: 1 }}>파트너 등급 관리</strong>
          <button onClick={onClose} className="gpu-btn" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tiers.length === 0 && <div style={{ fontSize: 12, color: 'var(--gpu-faint)' }}>등록된 등급이 없습니다</div>}
          {tiers.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '6px 8px', borderRadius: 7, background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--surface-bg)' }}>
              <input defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && patch(t.id, { name: e.target.value.trim() })}
                style={{ flex: 1, height: 28, fontSize: 12, border: 'var(--hairline) solid var(--gpu-border)', borderRadius: 6, padding: '0 6px' }} />
              <input defaultValue={String(t.discount_rate)} onBlur={(e) => Number(e.target.value) !== t.discount_rate && patch(t.id, { discount_rate: Number(e.target.value) })} inputMode="decimal"
                style={{ width: 56, height: 28, fontSize: 12, border: 'var(--hairline) solid var(--gpu-border)', borderRadius: 6, padding: '0 6px' }} />
              <span style={{ color: 'var(--gpu-muted)' }}>%↓</span>
              <button onClick={() => del(t.id, t.name)} className="gpu-btn" style={{ padding: 4, color: 'var(--gpu-red)' }}><Trash2 size={13} /></button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: 'var(--hairline) solid var(--gpu-border)', paddingTop: 10 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="등급명 (예: 골드)" style={{ flex: 1, height: 30, fontSize: 12.5, border: '1.5px solid var(--gpu-border)', borderRadius: 6, padding: '0 8px' }} />
            <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="15" inputMode="decimal" style={{ width: 56, height: 30, fontSize: 12.5, border: '1.5px solid var(--gpu-border)', borderRadius: 6, padding: '0 6px' }} />
            <span style={{ fontSize: 12, color: 'var(--gpu-muted)' }}>%↓</span>
            <button onClick={add} disabled={busy} className="gpu-btn gpu-btn-primary" style={{ gap: 4 }}>추가</button>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--gpu-red)' }}>{err}</div>}
        </div>
      </div>
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
  initialMargin?: number | null
  initialUsdKrw?: number | null
  onSearchChange?: (q: string) => void
  onExpandChange?: (id: string | null) => void
}

export default function PriceTableTab({ onGoToIntake, onGoToReview, initialSearch, onSearchConsumed, initialProductId, onProductFocusConsumed, initialMargin, initialUsdKrw, onSearchChange, onExpandChange }: PriceTableTabProps) {
  const { data, mutate: revalidate } = useSWR<ProductsResponse>('/api/pricing/gpu/products', fetcher, {
    refreshInterval: 60000,
  })
  const { data: partnerData, mutate: mutatePartner } = useSWR<{ tiers: PartnerTier[] }>('/api/pricing/gpu/partner-tiers', fetcher)
  const partnerTiers = partnerData?.tiers ?? []
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)
  const [showTierMgr, setShowTierMgr] = useState(false)
  const [tierFilter, setTierFilter] = useState(0)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [marginInput, setMarginInput] = useState<number | null>(null)
  const [marginSaving, setMarginSaving] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [currencyMode, setCurrencyMode] = useState<'KRW' | 'USD'>('KRW')
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; dir: SortDir } | null>(null)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<(GpuProduct & { _derived?: boolean }) | null>(null)

  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch)
      onSearchConsumed?.()
    }
  }, [initialSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  const products = data?.products ?? []

  // 공용 그룹 접기 — 모든 Tier·모델 키 수집, Tier 1 기본 펼침
  const allGroupKeys = useMemo(
    () => products.flatMap((p) => [tierKey(p.tier), modelKey(p.tier, p.model_name)]),
    [products],
  )
  const keepOpen = useMemo(() => [tierKey(1)], [])
  const { isCollapsed, toggle } = useCollapsibleGroups(allGroupKeys, true, keepOpen)

  // 외부(시장비교·공급사)에서 특정 상품으로 탐색 진입 시:
  // 해당 Tier·모델 그룹을 펼치고 견적까지 열어 위치를 보여준다.
  const focusHandled = useRef(false)
  useEffect(() => {
    if (!initialProductId || focusHandled.current || allGroupKeys.length === 0) return
    const prod = products.find((p) => p.id === initialProductId)
    if (prod) {
      // 해당 Tier 키·모델 키가 접혀 있으면 펼침
      const tKey = tierKey(prod.tier)
      const mKey = modelKey(prod.tier, prod.model_name)
      if (isCollapsed(tKey)) toggle(tKey)
      if (isCollapsed(mKey)) toggle(mKey)
    }
    setExpandedId(initialProductId)
    onProductFocusConsumed?.()
    focusHandled.current = true
    requestAnimationFrame(() => {
      const row = document.getElementById(`gpu-row-${initialProductId}`)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [initialProductId, allGroupKeys.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // 검색·펼친 상품 변경을 상위로 보고(뷰 상태 영속). 첫 마운트(빈값)는 건너뛰어 복원값을 덮어쓰지 않음.
  const searchReported = useRef(false)
  useEffect(() => {
    if (!searchReported.current) { searchReported.current = true; if (!search) return }
    onSearchChange?.(search)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps
  const expandReported = useRef(false)
  useEffect(() => {
    if (!expandReported.current) { expandReported.current = true; if (!expandedId) return }
    onExpandChange?.(expandedId)
  }, [expandedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 서버 프리페치(initialMargin/initialUsdKrw)를 폴백으로 → 하드코딩 18/1400 깜빡임 제거.
  // 설정값 부재 시에만 최후 안전망(18/1400) 사용.
  const marginPct = marginInput ?? data?.margin_pct ?? initialMargin ?? 18
  const usdKrw = data?.usd_krw ?? initialUsdKrw ?? 1400
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

  // ── 모델 그룹핑 + 수량 변형(x1/x2/x4/x8) 자동 도출 ──
  // 같은 model_name을 그룹으로 묶고, quote 상품은 1장당 단가 기준으로 표준 구성(1/2/4/8)을 도출.
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
        for (const n of STANDARD_LADDER) {
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

  // 공용 useCollapsibleGroups.toggle 위임
  function toggleModel(model: string, tier: number) {
    toggle(modelKey(tier, model))
  }

  function toggleTier(tier: number) {
    toggle(tierKey(tier))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* ── 고정 헤더 영역 ── */}
      <div style={{ flexShrink: 0 }}>
      {/* 최저가 갱신 배너 */}
      {!bannerDismissed && stats.pending > 0 && (
        <div className="gpu-banner">
          <div className="gpu-banner-dot">
            <Zap size={16} color="var(--brand)" />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Tag size={13} style={{ color: 'var(--gpu-muted)', flexShrink: 0 }} />
          {partnerTiers.length > 0 && (
            <select
              value={selectedTierId ?? ''}
              onChange={(e) => setSelectedTierId(e.target.value || null)}
              style={{
                fontSize: '12px', padding: '0.3rem 0.5rem', borderRadius: 'var(--radius)',
                border: 'var(--hairline) solid var(--gpu-border)', background: 'var(--gpu-surface)',
                color: selectedTierId ? 'var(--gpu-accent)' : 'var(--gpu-muted)',
                cursor: 'pointer', outline: 'none', fontWeight: selectedTierId ? 600 : 400,
              }}
            >
              <option value="">파트너 할인 없음</option>
              {partnerTiers.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.discount_rate}%↓)</option>
              ))}
            </select>
          )}
          <button onClick={() => setShowTierMgr(true)} className="gpu-btn" style={{ fontSize: 11, padding: '0.3rem 0.5rem' }} title="파트너 등급 관리">등급 관리</button>
        </div>
        <button className="gpu-btn" onClick={() => setShowAddProduct(true)} title="GPU 상품 직접 등록">
          <Plus size={15} /> 상품 추가
        </button>
        <button className="gpu-btn gpu-btn-primary" onClick={onGoToIntake}>
          <Plus size={15} /> 견적 등록
        </button>
      </div>

      {/* 마진 바 */}
      <div className="gpu-margin-bar">
        <div className="gpu-mb-left">
          <div className="gpu-mb-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          </div>
          <div>
            <strong>gcube 판매 마진</strong>
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

      </div>{/* end 고정 헤더 */}

      {/* ── 스크롤 영역 (리스트만) ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      {/* 가격표 — gpu-board-table-wrap: gpu-panel 스타일이되 overflow:hidden 없음(sticky thead 보장) */}
      <div className="gpu-board-table-wrap">
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
              // sortConfig 활성 시: flat 정렬 렌더 (그룹화 없음 — 정렬 순서 유지)
              // sortConfig null 시: Tier → 모델 2단계 그룹 렌더
              if (sortConfig !== null) {
                // flat 렌더: modelGroups 전체 rows를 sorted 순서대로 펼침
                // sorted는 이미 computeSellKrw/공급가 기준으로 정렬된 GpuProduct 배열
                return sorted.flatMap((p) => {
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
                            <div className="gpu-model-nm">
                              <GpuModelName modelName={p.model_name} gpuCount={p.gpu_count} />
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
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                            <div className="gpu-supplier-tag">
                              <span className="gpu-sdot" style={{ background: p.lowest_supplier.color }} />
                              {p.lowest_supplier.name}
                            </div>
                            {p.basis === 'selected' && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', background: 'var(--gpu-accent, var(--brand))', borderRadius: 4, padding: '0 5px' }}>✓ 기준</span>
                            )}
                            {p.basis === 'fallback' && (
                              <span title={p.fallback_reason ?? ''} style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', background: 'var(--gpu-red)', borderRadius: 4, padding: '0 5px' }}>⚠️ 기준만료→자동</span>
                            )}
                            {p.basis === 'list' && (
                              <span title="매입원가 미등록 — gcube 홈페이지 게시가를 그대로 사용" style={{ fontSize: 9.5, fontWeight: 800, color: '#fff', background: 'var(--gpu-amber, var(--warning))', borderRadius: 4, padding: '0 5px' }}>📢 {GPU_TERMS.gcubeListPrice}</span>
                            )}
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
                            <div className="gpu-price-main" style={p.basis === 'list' ? { color: 'var(--warning)' } : undefined}>
                              {currencyMode === 'KRW'
                                ? fmtKRW(sellKrw)
                                : fmtUSD(sellKrw / usdKrw)}
                              {p.basis === 'list' && <span title="gcube 홈페이지 금액" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--warning)', marginLeft: 4, verticalAlign: 'middle' }}>gcube</span>}
                            </div>
                            <div className="gpu-price-sub">
                              {currencyMode === 'KRW'
                                ? <>{fmtUSD(sellKrw / usdKrw)} · /hr</>
                                : <>/hr · {fmtKRW(sellKrw)}</>}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: '12px', color: 'var(--gpu-faint)' }}>—</div>
                        )}
                      </td>
                      <td>
                        {dday && (
                          <span className="gpu-mono" style={{ fontSize: '10px', color: dday.color }}>{dday.label}</span>
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
                            <ExpandedRow
                              productId={p.id}
                              usdKrw={usdKrw}
                              marginPct={marginPct}
                              currencyMode={currencyMode}
                              propagated={
                                p.is_propagated && p.per_gpu_usd != null
                                  ? {
                                      per_gpu_usd: p.per_gpu_usd,
                                      gpu_count: p.gpu_count,
                                      effective_supplier: p.lowest_supplier ?? null,
                                    }
                                  : null
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ),
                  ]
                })
              }

              // sortConfig === null: Tier → 모델 2단계 그룹 렌더
              const tierGroupsBuilt = buildTierModelGroups(
                sorted
              )
              // modelGroups는 파생 행 포함한 원본 Map을 유지해야 하므로
              // 모델명별로 빠른 조회가 되도록 Map으로 변환
              const modelGroupByKey = new Map(modelGroups.map((g) => [g.model, g]))

              const renderGroup = (group: (typeof modelGroups)[number]) => {
              const tierCfg = TIER_CONFIG[group.tier]
              const mKey = modelKey(group.tier, group.model)
              const collapsed = isCollapsed(mKey)
              // 해당 모델의 첫 번째 실제(non-derived) 상품 — 편집 진입점
              const representativeProduct = group.rows.find((r) => !r._derived) ?? null
              const groupHeader = (
                <tr key={`grp-${group.model}`} className="gpu-group-header" onClick={() => toggleModel(group.model, group.tier)} style={{ cursor: 'pointer', background: 'var(--surface-bg)' }}>
                  <td colSpan={colCount}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ChevronRight size={15} style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.15s', color: 'var(--gpu-muted)' }} />
                      <span className={`gpu-badge ${tierCfg.badge}`} style={{ fontSize: 10 }}>{tierCfg.label}</span>
                      <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{group.model}</strong>
                      <span style={{ fontSize: 11, color: 'var(--gpu-muted)' }}>
                        {group.rows.length}개 구성{group.perGpu != null ? ` · 1장당 ${currencyMode === 'KRW' ? fmtKRW(Math.round(group.perGpu * usdKrw)) : fmtUSD(group.perGpu)}/GPU·hr` : ''}
                      </span>
                      {representativeProduct && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingProduct(representativeProduct) }}
                          title="상품 수정"
                          aria-label="상품 수정"
                          style={{ marginLeft: 'auto', border: 'var(--hairline) solid var(--border-light)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', background: '#fff', color: 'var(--text-muted)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        >
                          <Pencil size={10} /> 상품 수정
                        </button>
                      )}
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
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  style={p._derived ? { opacity: 0.92 } : undefined}
                >
                  <td>
                    <div className="gpu-model-cell">
                      <div className="gpu-chip" style={{ background: tier.chipColor }}>
                        {firstLetter}
                        <span>{p.memory}</span>
                      </div>
                      <div>
                        <div className="gpu-model-nm">
                          <GpuModelName modelName={p.model_name} gpuCount={p.gpu_count} isDerived={p._derived} />
                          {p._derived && <span style={{ fontSize: '10px', color: 'var(--gpu-accent)', marginLeft: 6, fontWeight: 600 }}>추정</span>}
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                        <div className="gpu-supplier-tag">
                          <span className="gpu-sdot" style={{ background: p.lowest_supplier.color }} />
                          {p.lowest_supplier.name}
                        </div>
                        {p.basis === 'selected' && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', background: 'var(--gpu-accent, var(--brand))', borderRadius: 4, padding: '0 5px' }}>✓ 기준</span>
                        )}
                        {p.basis === 'fallback' && (
                          <span title={p.fallback_reason ?? ''} style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', background: 'var(--gpu-red)', borderRadius: 4, padding: '0 5px' }}>⚠️ 기준만료→자동</span>
                        )}
                        {p.basis === 'list' && (
                          <span title="매입원가 미등록 — gcube 홈페이지 게시가를 그대로 사용" style={{ fontSize: 9.5, fontWeight: 800, color: '#fff', background: 'var(--gpu-amber, var(--warning))', borderRadius: 4, padding: '0 5px' }}>📢 {GPU_TERMS.gcubeListPrice}</span>
                        )}
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
                        <div className="gpu-price-main" style={p.basis === 'list' ? { color: 'var(--warning)' } : undefined}>
                          {currencyMode === 'KRW'
                            ? fmtKRW(sellKrw)
                            : fmtUSD(sellKrw / usdKrw)}
                          {p.basis === 'list' && <span title="gcube 홈페이지 금액" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--warning)', marginLeft: 4, verticalAlign: 'middle' }}>gcube</span>}
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
                      <span className="gpu-badge" style={{ background: 'var(--brand-soft)', color: 'var(--gpu-accent)' }}>1장당×{p.gpu_count} 추정</span>
                    ) : p.pricing_mode === 'direct' ? (
                      <span className="gpu-badge gpu-badge-amber">직접입력</span>
                    ) : p.lowest_unit_price_usd != null ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {p.is_propagated ? (
                          <span className="gpu-badge" style={{ background: 'var(--brand-soft)', color: 'var(--gpu-accent)' }} title="모델 최저 1장당 단가를 이 구성에 전파한 추정가">
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
                    <ChevronRight
                      size={18}
                      className={`gpu-chev${isExpanded ? ' open' : ''}`}
                    />
                  </td>
                </tr>,
                isExpanded && (
                  <tr key={`${p.id}-expand`} className="gpu-detail-row">
                    <td colSpan={colCount} style={{ padding: 0 }}>
                      {p._derived ? (
                        /* _derived(추정) 행: 전파 근거 섹션 */
                        <DerivedPropagatedSection
                          p={p}
                          usdKrw={usdKrw}
                          currencyMode={currencyMode}
                        />
                      ) : p.pricing_mode === 'direct' ? (
                        <div className="gpu-expand-body gpu-expand-direct">
                          <Info size={13} />
                          <span>Tier 3 — 공급 견적 없음. 판매가는 직접 입력 방식으로 관리됩니다.</span>
                          {sellKrw && <strong className="gpu-mono">{fmtKRW(sellKrw)}/hr (현재가)</strong>}
                        </div>
                      ) : (
                        <ExpandedRow
                          productId={p.id}
                          usdKrw={usdKrw}
                          marginPct={marginPct}
                          currencyMode={currencyMode}
                          propagated={
                            p.is_propagated && p.per_gpu_usd != null
                              ? {
                                  per_gpu_usd: p.per_gpu_usd,
                                  gpu_count: p.gpu_count,
                                  effective_supplier: p.lowest_supplier ?? null,
                                }
                              : null
                          }
                        />
                      )}
                    </td>
                  </tr>
                ),
              ]
              })
              return [groupHeader, ...memberRows]
              }
              return tierGroupsBuilt.flatMap((tg) => {
                const tKey = tierKey(tg.tier)
                const tierCollapsed = isCollapsed(tKey)
                const tcfg = TIER_CONFIG[tg.tier as 1 | 2 | 3]
                const tierHeader = (
                  <tr key={`tier-${tg.tier}`} className="gpu-group-header" onClick={() => toggleTier(tg.tier)} style={{ cursor: 'pointer', background: 'var(--surface-bg)' }}>
                    <td colSpan={colCount}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ChevronRight size={16} style={{ transform: tierCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.15s', color: 'var(--gpu-muted)' }} />
                        <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{tcfg.label}</strong>
                        <span style={{ fontSize: 11.5, color: 'var(--gpu-muted)' }}>{tg.count}개 모델</span>
                      </div>
                    </td>
                  </tr>
                )
                if (tierCollapsed) return [tierHeader]
                // modelGroupByKey로 파생 행 포함 원본 그룹 조회
                const groups = tg.models.map((mg) => modelGroupByKey.get(mg.model)).filter(Boolean) as typeof modelGroups
                return [tierHeader, ...groups.flatMap(renderGroup)]
              })
            })()}
          </tbody>
        </table>
      </div>
      </div>{/* end 스크롤 영역 */}
      {showTierMgr && <PartnerTierManagerModal tiers={partnerTiers} onClose={() => setShowTierMgr(false)} onChanged={() => mutatePartner()} />}
      {showAddProduct && (
        <ProductAddModal onClose={() => setShowAddProduct(false)} onAdded={() => revalidate()} />
      )}
      {editingProduct && !editingProduct._derived && (
        <ProductEditModal
          product={{
            id: editingProduct.id,
            model_name: editingProduct.model_name,
            memory: editingProduct.memory,
            tier: editingProduct.tier,
            series: editingProduct.series ?? null,
            pricing_mode: editingProduct.pricing_mode,
          }}
          onClose={() => setEditingProduct(null)}
          onSaved={() => revalidate()}
        />
      )}
    </div>
  )
}
