'use client'

import React, { useState, useRef, useCallback } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { Pencil, ChevronRight, X, Check } from 'lucide-react'
import { fetcher } from '@/lib/swr-config'
import { fmtKRW } from '@/lib/gpu/format-price'
import { marginSignal, deviationSignal } from '@/lib/gpu/price-signal'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import {
  PRICE_SIGNAL_CLASS,
  DEVIATION_SIGNAL_CLASS,
  type PriceSignalKey,
  type DeviationSignalKey,
} from '@/lib/tokens/status-colors'

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface StrategicHistoryEntry {
  ts: string
  actor: string
  before: number | null
  after: number | null
  reason: string | null
}

interface CockpitProduct {
  id: string
  model_name: string
  memory: string
  tier: 1 | 2 | 3
  gpu_count: number
  series: string | null
  pricing_mode: string
  cost_krw: number | null
  auto_margin_krw: number | null
  strategic_price_krw: number | null
  strategic_krw: number | null
  is_strategic_set: boolean
  effective_margin_pct: number | null
  market_median_krw: number | null
  market_min_krw: number | null
  market_max_krw: number | null
  market_deviation_pct: number | null
  basis: string | null
  is_propagated: boolean
  effective_supplier: string | null
  /** gcube 공시가(KRW). null=미등록 */
  list_price_krw: number | null
  /** 전략가 변경 이력 (최근 5건) */
  strategic_history: StrategicHistoryEntry[]
}

interface CockpitResponse {
  products: CockpitProduct[]
  usd_krw: number
  fx_date: string | null
  margin_pct: number
}

// ── 시그널 뱃지 ──────────────────────────────────────────────────────────────

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="cockpit-price-sub">—</span>
  const sig = marginSignal(pct) as PriceSignalKey
  const cls = PRICE_SIGNAL_CLASS[sig]
  const label = pct.toFixed(1) + '%'
  return <span className={`cockpit-signal ${cls}`}>{label}</span>
}

function DeviationBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="cockpit-price-sub">—</span>
  const sig = deviationSignal(pct) as DeviationSignalKey
  const cls = DEVIATION_SIGNAL_CLASS[sig]
  const label = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
  return <span className={`cockpit-signal ${cls}`}>{label}</span>
}

// ── 인라인 편집 셀 ────────────────────────────────────────────────────────────

interface StrategicCellProps {
  product: CockpitProduct
  isAdmin: boolean
  onSaved: () => void
}

function StrategicCell({ product, isAdmin, onSaved }: StrategicCellProps) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(() => {
    setInputVal(product.strategic_price_krw != null ? String(product.strategic_price_krw) : '')
    setSaveError(null)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [product.strategic_price_krw])

  const cancel = useCallback(() => {
    setEditing(false)
    setInputVal('')
    setSaveError(null)
  }, [])

  const save = useCallback(async () => {
    if (saving) return
    const trimmed = inputVal.trim()
    // 음수 차단: 숫자(0-9)만 허용 → 음수·소수 입력 자체를 막음
    const digitsOnly = trimmed.replace(/[^0-9]/g, '')
    const priceKrw = trimmed === '' ? null : Number(digitsOnly)
    if (trimmed !== '' && (!priceKrw || priceKrw <= 0)) {
      setSaveError('0보다 큰 금액을 입력하세요')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/pricing/gpu/strategic-price', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: product.id, strategic_price_krw: priceKrw }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? '저장 실패')
      }
      setEditing(false)
      setSaveError(null)
      onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }, [inputVal, product.id, saving, onSaved])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') save()
      if (e.key === 'Escape') cancel()
    },
    [save, cancel],
  )

  if (!isAdmin) {
    // 비admin: 읽기 전용 표시
    return (
      <div className="cockpit-strategic-cell">
        {product.is_strategic_set ? (
          <span className="cockpit-price--strategic">{fmtKRW(product.strategic_price_krw)}</span>
        ) : (
          <span className="cockpit-price--auto">{fmtKRW(product.auto_margin_krw)}</span>
        )}
      </div>
    )
  }

  if (editing) {
    return (
      <div className="cockpit-strategic-cell">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          className="cockpit-inline-input"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="금액(원)"
          aria-label="전략가 입력"
        />
        <div className="cockpit-inline-actions">
          <button
            className="cockpit-edit-btn"
            onClick={save}
            disabled={saving}
            aria-label="저장"
            title="저장 (Enter)"
          >
            {saving ? <span className="cockpit-saving-dot">…</span> : <Check size={12} />}
          </button>
          <button
            className="cockpit-edit-btn"
            onClick={cancel}
            aria-label="취소"
            title="취소 (Esc)"
          >
            <X size={12} />
          </button>
        </div>
        {saveError && (
          <span className="cockpit-error-hint" role="alert" aria-live="polite">
            {saveError}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="cockpit-strategic-cell">
      {product.is_strategic_set ? (
        <span className="cockpit-price--strategic">{fmtKRW(product.strategic_price_krw)}</span>
      ) : (
        <span className="cockpit-price--auto" title="전략가 미설정 — 자동마진가 적용 중">
          {fmtKRW(product.auto_margin_krw)}
        </span>
      )}
      <button
        className="cockpit-edit-btn"
        onClick={startEdit}
        aria-label="전략가 편집"
        title={product.is_strategic_set ? '전략가 수정 / 해제' : '전략가 지정'}
      >
        <Pencil size={12} />
      </button>
    </div>
  )
}

// ── 행 드로어 ────────────────────────────────────────────────────────────────

function DrawerRow({ product }: { product: CockpitProduct }) {
  return (
    <tr className="cockpit-drawer">
      <td colSpan={7} className="cockpit-drawer-td">
        <div className="cockpit-drawer-inner">
          {product.cost_krw != null && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">공급원가</span>
              <span className="cockpit-drawer-value">{fmtKRW(product.cost_krw)}</span>
            </div>
          )}
          {product.market_min_krw != null && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">시장 최저</span>
              <span className="cockpit-drawer-value">{fmtKRW(product.market_min_krw)}</span>
            </div>
          )}
          {product.market_median_krw != null && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">시장 중앙</span>
              <span className="cockpit-drawer-value">{fmtKRW(product.market_median_krw)}</span>
            </div>
          )}
          {product.market_max_krw != null && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">시장 최고</span>
              <span className="cockpit-drawer-value">{fmtKRW(product.market_max_krw)}</span>
            </div>
          )}
          {product.list_price_krw != null && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">공시가</span>
              <span className="cockpit-drawer-value">{fmtKRW(product.list_price_krw)}</span>
            </div>
          )}
          {product.effective_supplier && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">실효 공급사</span>
              <span className="cockpit-drawer-value">{product.effective_supplier}</span>
            </div>
          )}
          {product.basis && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">기준가 선정</span>
              <span className="cockpit-drawer-value">{product.basis}</span>
            </div>
          )}
          {product.effective_margin_pct != null && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">실효마진</span>
              <span className="cockpit-drawer-value">{product.effective_margin_pct.toFixed(1)}%</span>
            </div>
          )}
          {product.market_deviation_pct != null && (
            <div className="cockpit-drawer-group">
              <span className="cockpit-drawer-label">시장 편차</span>
              <span className="cockpit-drawer-value">
                {(product.market_deviation_pct >= 0 ? '+' : '') +
                  product.market_deviation_pct.toFixed(1)}%
              </span>
            </div>
          )}
          {product.strategic_history.length > 0 && (
            <div className="cockpit-drawer-group cockpit-drawer-group--history">
              <span className="cockpit-drawer-label">전략가 이력</span>
              <ul className="cockpit-history-list">
                {product.strategic_history.map((h, i) => (
                  <li key={i} className="cockpit-history-item">
                    <span className="cockpit-history-ts">
                      {new Date(h.ts).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="cockpit-history-actor">{h.actor}</span>
                    <span className="cockpit-history-change">
                      {h.before != null ? fmtKRW(h.before) : '미설정'} →{' '}
                      {h.after != null ? fmtKRW(h.after) : '해제'}
                    </span>
                    {h.reason && (
                      <span className="cockpit-history-reason">{h.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

interface PriceCockpitTabProps {
  isAdmin?: boolean
}

export default function PriceCockpitTab({ isAdmin = false }: PriceCockpitTabProps) {
  const { data, isLoading, error, mutate } = useSWR<CockpitResponse>(
    '/api/pricing/gpu/cockpit',
    fetcher,
    { refreshInterval: 60000 },
  )
  const { mutate: globalMutate } = useSWRConfig()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSaved = useCallback(() => {
    mutate()
    mutateGpu(globalMutate)
  }, [mutate, globalMutate])

  const products = data?.products ?? []

  // ── 로딩 ──
  if (isLoading) {
    return (
      <div className="price-cockpit-wrap">
        <div className="gpu-empty-hint">로딩 중…</div>
      </div>
    )
  }

  // ── 에러 ──
  if (error) {
    return (
      <div className="price-cockpit-wrap">
        <div className="gpu-empty-hint cockpit-error-hint">
          데이터를 불러오지 못했습니다. 새로고침해 주세요.
        </div>
      </div>
    )
  }

  // ── 빈 상태 ──
  if (products.length === 0) {
    return (
      <div className="price-cockpit-wrap">
        <div className="gpu-empty-hint">등록된 GPU 상품이 없습니다.</div>
      </div>
    )
  }

  return (
    <div className="price-cockpit-wrap">
      <div className="gpu-panel">
        <table className="gpu-table table-base table-card price-cockpit-table">
          <thead>
            <tr>
              <th className="cockpit-th-left">모델·구성</th>
              <th>원가</th>
              <th>자동마진가</th>
              <th>🎯 전략가</th>
              <th>시장중앙</th>
              <th>실효마진%</th>
              <th>시장편차%</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const expanded = expandedIds.has(p.id)
              return (
                <React.Fragment key={p.id}>
                  <tr
                    className="cockpit-row"
                    onClick={() => toggleExpand(p.id)}
                    aria-expanded={expanded}
                  >
                    {/* 모델·구성 */}
                    <td className="card-header" data-label="모델·구성">
                      <div className="cockpit-model-row">
                        <button
                          className={`cockpit-expand-btn${expanded ? ' cockpit-expand-btn--open' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleExpand(p.id) }}
                          aria-label={expanded ? '접기' : '상세 보기'}
                        >
                          <ChevronRight size={14} />
                        </button>
                        <div className="cockpit-model-cell">
                          <span className="cockpit-model-name">{p.model_name}</span>
                          <span className="cockpit-model-sub">
                            {p.memory} · ×{p.gpu_count}GPU · Tier {p.tier}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 원가 */}
                    <td data-label="원가" onClick={(e) => e.stopPropagation()}>
                      <div className="cockpit-price--auto">{fmtKRW(p.cost_krw)}</div>
                    </td>

                    {/* 자동마진가 */}
                    <td data-label="자동마진가" onClick={(e) => e.stopPropagation()}>
                      <div className="cockpit-price--auto">{fmtKRW(p.auto_margin_krw)}</div>
                    </td>

                    {/* 🎯 전략가 — 인라인 편집 */}
                    <td
                      data-label="전략가"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <StrategicCell
                        product={p}
                        isAdmin={isAdmin}
                        onSaved={handleSaved}
                      />
                    </td>

                    {/* 시장중앙 */}
                    <td data-label="시장중앙">
                      <div className="cockpit-price">{fmtKRW(p.market_median_krw)}</div>
                    </td>

                    {/* 실효마진% */}
                    <td data-label="실효마진%">
                      <MarginBadge pct={p.effective_margin_pct} />
                    </td>

                    {/* 시장편차% */}
                    <td data-label="시장편차%">
                      <DeviationBadge pct={p.market_deviation_pct} />
                    </td>
                  </tr>

                  {expanded && <DrawerRow product={p} />}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
