'use client'

import { useState } from 'react'
import { useEscClose } from '@/lib/use-esc-close'
import { X, Pencil } from 'lucide-react'
import ImpactDeleteDialog from './ImpactDeleteDialog'

export interface MarketPriceForEdit {
  price_id: string
  price_usd: number
  competitor_name: string
  sku: string
  pricing_model: string
  notes: string | null
}

interface MarketPriceEditModalProps {
  price: MarketPriceForEdit
  onClose: () => void
  onSaved?: () => void
}

const PRICING_MODEL_LABEL: Record<string, string> = {
  on_demand: 'On-Demand',
  reserved_1y: '1년 약정',
  reserved_3y: '3년 약정',
  spot: 'Spot',
  committed: '커밋',
}

type DeleteState =
  | { phase: 'idle' }
  | { phase: 'confirm' }
  | { phase: 'busy' }

export default function MarketPriceEditModal({ price, onClose, onSaved }: MarketPriceEditModalProps) {
  useEscClose(onClose)

  const [priceUsd, setPriceUsd] = useState(String(price.price_usd))
  const [notes, setNotes] = useState(price.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteState, setDeleteState] = useState<DeleteState>({ phase: 'idle' })
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleSave = async () => {
    const v = parseFloat(priceUsd)
    if (isNaN(v) || v <= 0) { setError('가격은 0보다 커야 합니다'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/pricing/gpu/market/prices?id=${price.price_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_usd: v, notes: notes.trim() || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? '수정 실패')
        return
      }
      onSaved?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setDeleteState({ phase: 'busy' })
    setDeleteError(null)
    try {
      const res = await fetch(`/api/pricing/gpu/market/prices?id=${price.price_id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setDeleteError(j.error ?? '삭제 실패')
        setDeleteState({ phase: 'confirm' })
        return
      }
      onSaved?.()
      onClose()
    } catch {
      setDeleteError('삭제 중 오류가 발생했습니다')
      setDeleteState({ phase: 'confirm' })
    }
  }

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mp-edit-title"
        className="gpu-modal-backdrop"
        onClick={onClose}
      >
        <div
          className="gpu-modal-card gpu-modal-card--sm"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="gpu-modal-header">
            <span className="gpu-modal-header-icon">
              <Pencil size={14} />
            </span>
            <div style={{ flex: 1 }}>
              <strong id="mp-edit-title" className="gpu-modal-title">경쟁가 수정</strong>
              <span className="gpu-modal-subtitle">
                {price.competitor_name} · {PRICING_MODEL_LABEL[price.pricing_model] ?? price.pricing_model}
                {price.sku ? ` · ${price.sku}` : ''}
              </span>
            </div>
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
          <div className="gpu-modal-body">
            <div>
              <label htmlFor="mp-price" className="gpu-field-label">
                가격 (USD/GPU·hr) <span className="gpu-field-required">*</span>
              </label>
              <input
                id="mp-price"
                type="number"
                step="0.0001"
                min="0.0001"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                placeholder="예: 2.39"
                autoFocus
                className="gpu-field-input"
              />
            </div>

            <div>
              <label htmlFor="mp-notes" className="gpu-field-label">메모 (선택)</label>
              <input
                id="mp-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="예: 프로모션 가격, 할인 감지됨 등"
                className="gpu-field-input"
              />
            </div>

            {error && <div className="gpu-field-error">{error}</div>}

            <div className="gpu-modal-actions">
              <button
                type="button"
                onClick={() => { setDeleteState({ phase: 'confirm' }); setDeleteError(null) }}
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

      {(deleteState.phase === 'confirm' || deleteState.phase === 'busy') && (
        <ImpactDeleteDialog
          title="경쟁가 삭제"
          subject={`${price.competitor_name} ${PRICING_MODEL_LABEL[price.pricing_model] ?? price.pricing_model} $${price.price_usd} 경쟁가`}
          busy={deleteState.phase === 'busy'}
          error={deleteError}
          onCancel={() => { setDeleteState({ phase: 'idle' }); setDeleteError(null) }}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </>
  )
}
