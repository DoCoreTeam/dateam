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
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,.52)',
          zIndex: 9100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 'var(--space-5)',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            width: 'min(420px, 100%)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* 헤더 */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: 'var(--hairline) solid var(--border-light)',
          }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 'var(--radius)',
              background: 'var(--brand-soft)', color: 'var(--brand)', flexShrink: 0, marginRight: 'var(--space-3)',
            }}>
              <Pencil size={14} />
            </span>
            <div style={{ flex: 1 }}>
              <strong id="mp-edit-title" style={{ fontSize: 'var(--fs-base)', display: 'block' }}>경쟁가 수정</strong>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {price.competitor_name} · {PRICING_MODEL_LABEL[price.pricing_model] ?? price.pricing_model}
                {price.sku ? ` · ${price.sku}` : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* 바디 */}
          <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div>
              <label htmlFor="mp-price" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                가격 (USD/GPU·hr) <span style={{ color: 'var(--danger)' }}>*</span>
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
                style={{
                  width: '100%', boxSizing: 'border-box',
                  height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)',
                }}
              />
            </div>

            <div>
              <label htmlFor="mp-notes" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                메모 (선택)
              </label>
              <input
                id="mp-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="예: 프로모션 가격, 할인 감지됨 등"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)',
                }}
              />
            </div>

            {error && (
              <div style={{
                fontSize: 'var(--fs-sm)', color: 'var(--danger)',
                background: 'var(--danger-bg)', borderRadius: 'var(--radius)',
                padding: 'var(--space-3)',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between', paddingTop: 'var(--space-2)' }}>
              <button
                type="button"
                onClick={() => { setDeleteState({ phase: 'confirm' }); setDeleteError(null) }}
                disabled={busy}
                style={{
                  minHeight: 44, padding: '0 var(--space-4)',
                  border: 'var(--border-w) solid var(--danger-border)',
                  borderRadius: 'var(--radius)', background: '#fff',
                  color: 'var(--danger)', fontWeight: 600, fontSize: 'var(--fs-sm)',
                  cursor: 'pointer',
                }}
              >
                삭제
              </button>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="gpu-btn"
                  style={{ minHeight: 44 }}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy}
                  className="gpu-btn gpu-btn-primary"
                  style={{ minHeight: 44, opacity: busy ? 0.7 : 1 }}
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
