'use client'

import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { useEscClose } from '@/lib/use-esc-close'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { X, Pencil } from 'lucide-react'
import ImpactDeleteDialog from './ImpactDeleteDialog'

const GPU_COUNT_OPTIONS = [1, 2, 4, 8] as const
type GpuCount = (typeof GPU_COUNT_OPTIONS)[number]

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
    (GPU_COUNT_OPTIONS as readonly number[]).includes(quote.gpu_count)
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
            width: 'min(480px, 100%)',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* 헤더 */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: 'var(--hairline) solid var(--border-light)',
            position: 'sticky', top: 0, background: '#fff', zIndex: 1,
          }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 'var(--radius)',
              background: 'var(--brand-soft)', color: 'var(--brand)', flexShrink: 0, marginRight: 'var(--space-3)',
            }}>
              <Pencil size={14} />
            </span>
            <strong id="quote-edit-title" style={{ fontSize: 'var(--fs-base)', flex: 1 }}>
              견적 수정{supplierLabel}
            </strong>
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
          <div
            role="form"
            aria-label="견적 수정"
            style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            {/* 단가 */}
            <div>
              <label htmlFor="qe-price" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                공급 단가 (USD/GPU·hr) <span style={{ color: 'var(--danger)' }}>*</span>
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
                style={{
                  width: '100%', boxSizing: 'border-box',
                  height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)',
                }}
              />
            </div>

            {/* GPU 수량 */}
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                GPU 수량 <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-faint)', marginLeft: 4 }}>1·2·4·8만 가능</span>
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {GPU_COUNT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setGpuCount(n)}
                    style={{
                      flex: 1, height: 40,
                      border: `var(--border-w-2) solid ${gpuCount === n ? 'var(--brand)' : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius)',
                      background: gpuCount === n ? 'var(--brand-soft)' : '#fff',
                      color: gpuCount === n ? 'var(--brand)' : 'var(--text-muted)',
                      fontWeight: gpuCount === n ? 700 : 400,
                      fontSize: 'var(--fs-sm)', cursor: 'pointer', transition: 'all 0.12s',
                    }}
                  >
                    ×{n}
                  </button>
                ))}
              </div>
            </div>

            {/* 계약 기간 + 최소 수량 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor="qe-term" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  계약 기간
                </label>
                <input
                  id="qe-term"
                  type="text"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="예: 월·분기"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    height: 40, fontSize: 'var(--fs-sm)',
                    border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                    padding: '0 var(--space-3)',
                  }}
                />
              </div>
              <div>
                <label htmlFor="qe-min-qty" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  최소 수량
                </label>
                <input
                  id="qe-min-qty"
                  type="text"
                  value={minQty}
                  onChange={(e) => setMinQty(e.target.value)}
                  placeholder="예: 1개"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    height: 40, fontSize: 'var(--fs-sm)',
                    border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                    padding: '0 var(--space-3)',
                  }}
                />
              </div>
            </div>

            {/* 유효 기한 */}
            <div>
              <label htmlFor="qe-valid-until" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                유효 기한
              </label>
              <input
                id="qe-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
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

            {/* 액션 */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between', paddingTop: 'var(--space-2)' }}>
              <button
                type="button"
                onClick={handleDeleteRequest}
                disabled={busy}
                style={{
                  minHeight: 44, padding: '0 var(--space-4)',
                  border: 'var(--border-w) solid var(--danger-border)',
                  borderRadius: 'var(--radius)', background: '#fff',
                  color: 'var(--danger)', fontWeight: 600, fontSize: 'var(--fs-sm)',
                  cursor: 'pointer', transition: 'all 0.12s',
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
