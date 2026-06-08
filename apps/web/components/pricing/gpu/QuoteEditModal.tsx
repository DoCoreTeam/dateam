'use client'

import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { useEscClose } from '@/lib/use-esc-close'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { STANDARD_LADDER } from '@/lib/gpu/config-ladder'
import { X, Pencil } from 'lucide-react'
import ImpactDeleteDialog from './ImpactDeleteDialog'

type GpuCount = (typeof STANDARD_LADDER)[number]

export interface QuoteForEdit {
  id: string
  unit_price_usd: number
  gpu_count: number
  term: string | null
  min_qty: string | null
  valid_until: string | null
  supplier_name?: string | null
}

interface QuoteEditModalProps {
  quote: QuoteForEdit
  productId: string
  onClose: () => void
  onSaved?: () => void
}

type DeleteState =
  | { phase: 'idle' }
  | { phase: 'confirm' }
  | { phase: 'force'; impactDetail: Record<string, number> }
  | { phase: 'busy'; force: boolean }

export default function QuoteEditModal({ quote, productId, onClose, onSaved }: QuoteEditModalProps) {
  useEscClose(onClose)
  const { mutate } = useSWRConfig()

  const [unitPrice, setUnitPrice] = useState(String(quote.unit_price_usd))
  const [gpuCount, setGpuCount] = useState<GpuCount>(
    (STANDARD_LADDER as readonly number[]).includes(quote.gpu_count)
      ? (quote.gpu_count as GpuCount)
      : 1
  )
  const [term, setTerm] = useState(quote.term ?? '')
  const [minQty, setMinQty] = useState(quote.min_qty ?? '')
  const [validUntil, setValidUntil] = useState(quote.valid_until ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteState, setDeleteState] = useState<DeleteState>({ phase: 'idle' })
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const price = parseFloat(unitPrice)
    if (isNaN(price) || price <= 0) { setError('단가는 0보다 커야 합니다'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${quote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_price_usd: price,
          gpu_count: gpuCount,
          term: term.trim() || null,
          min_qty: minQty.trim() || null,
          valid_until: validUntil || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? '수정 실패')
        return
      }
      mutate(`/api/pricing/gpu/quotes?product_id=${productId}`)
      mutateGpu(mutate)
      onSaved?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteRequest = () => {
    setDeleteState({ phase: 'confirm' })
    setDeleteError(null)
  }

  const handleDeleteConfirm = async (force: boolean) => {
    setDeleteState({ phase: 'busy', force })
    setDeleteError(null)
    try {
      const url = force
        ? `/api/pricing/gpu/quotes/${quote.id}?force=true`
        : `/api/pricing/gpu/quotes/${quote.id}`
      const res = await fetch(url, { method: 'DELETE' })
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}))
        setDeleteState({ phase: 'force', impactDetail: j.impact ?? {} })
        setDeleteError(j.error ?? null)
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setDeleteError(j.error ?? '삭제 실패')
        setDeleteState({ phase: 'confirm' })
        return
      }
      mutate(`/api/pricing/gpu/quotes?product_id=${productId}`)
      mutateGpu(mutate)
      onSaved?.()
      onClose()
    } catch {
      setDeleteError('삭제 중 오류가 발생했습니다')
      setDeleteState({ phase: 'confirm' })
    }
  }

  const handleDeleteCancel = () => {
    setDeleteState({ phase: 'idle' })
    setDeleteError(null)
  }

  const supplierLabel = quote.supplier_name ? ` (${quote.supplier_name})` : ''

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quote-edit-title"
        className="gpu-modal-backdrop"
        onClick={onClose}
      >
        <div
          className="gpu-modal-card gpu-modal-card--md gpu-modal-card--scroll"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="gpu-modal-header">
            <span className="gpu-modal-header-icon">
              <Pencil size={14} />
            </span>
            <strong id="quote-edit-title" className="gpu-modal-title">
              견적 수정{supplierLabel}
            </strong>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="gpu-modal-close"
            >
              <X size={16} />
            </button>
          </div>

          {/* 바디 */}
          <div
            role="form"
            aria-label="견적 수정"
            className="gpu-modal-body"
          >
            {/* 단가 */}
            <div>
              <label htmlFor="qe-price" className="gpu-field-label">
                공급 단가 (USD/GPU·hr) <span className="gpu-field-required">*</span>
              </label>
              <input
                id="qe-price"
                type="number"
                step="0.0001"
                min="0.0001"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="예: 2.49"
                required
                autoFocus
                className="gpu-field-input"
              />
            </div>

            {/* GPU 수량 */}
            <div>
              <label className="gpu-field-label">
                GPU 수량 <span className="gpu-field-hint">1·2·4·8만 가능</span>
              </label>
              <div className="gpu-count-group">
                {STANDARD_LADDER.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setGpuCount(n)}
                    className={`gpu-count-btn${gpuCount === n ? ' active' : ''}`}
                  >
                    ×{n}
                  </button>
                ))}
              </div>
            </div>

            {/* 계약 기간 + 최소 수량 */}
            <div className="gpu-form-grid-2">
              <div>
                <label htmlFor="qe-term" className="gpu-field-label">계약 기간</label>
                <input
                  id="qe-term"
                  type="text"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="예: 월·분기"
                  className="gpu-field-input"
                />
              </div>
              <div>
                <label htmlFor="qe-min-qty" className="gpu-field-label">최소 수량</label>
                <input
                  id="qe-min-qty"
                  type="text"
                  value={minQty}
                  onChange={(e) => setMinQty(e.target.value)}
                  placeholder="예: 1개"
                  className="gpu-field-input"
                />
              </div>
            </div>

            {/* 유효 기한 */}
            <div>
              <label htmlFor="qe-valid-until" className="gpu-field-label">유효 기한</label>
              <input
                id="qe-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="gpu-field-input"
              />
            </div>

            {error && <div className="gpu-field-error">{error}</div>}

            {/* 액션 */}
            <div className="gpu-modal-actions">
              <button
                type="button"
                onClick={handleDeleteRequest}
                disabled={busy}
                className="gpu-btn-delete-outline"
              >
                삭제
              </button>
              <div className="gpu-modal-actions-right">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="gpu-btn"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy}
                  className="gpu-btn gpu-btn-primary"
                >
                  {busy ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 삭제 확인 다이얼로그 */}
      {(deleteState.phase === 'confirm' || deleteState.phase === 'force' || deleteState.phase === 'busy') && (
        <ImpactDeleteDialog
          title="견적 삭제"
          subject={`${quote.supplier_name ? quote.supplier_name + ' ' : ''}$${quote.unit_price_usd.toFixed(4)} 견적`}
          impactDetail={deleteState.phase === 'force' ? deleteState.impactDetail : undefined}
          forceMode={deleteState.phase === 'force'}
          busy={deleteState.phase === 'busy'}
          error={deleteError}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </>
  )
}
