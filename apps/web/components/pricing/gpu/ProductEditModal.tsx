'use client'

import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { useEscClose } from '@/lib/use-esc-close'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { X, Pencil } from 'lucide-react'
import ImpactDeleteDialog from './ImpactDeleteDialog'

export interface ProductForEdit {
  id: string
  model_name: string
  memory: string | null
  tier: 1 | 2 | 3
  series: string | null
  pricing_mode: 'quote' | 'direct'
}

interface ProductEditModalProps {
  product: ProductForEdit
  onClose: () => void
  onSaved?: () => void
}

type DeleteState =
  | { phase: 'idle' }
  | { phase: 'confirm' }
  | { phase: 'force'; impactDetail: Record<string, number> }
  | { phase: 'busy'; force: boolean }

export default function ProductEditModal({ product, onClose, onSaved }: ProductEditModalProps) {
  useEscClose(onClose)
  const { mutate } = useSWRConfig()

  const [modelName, setModelName] = useState(product.model_name)
  const [memory, setMemory] = useState(product.memory ?? '')
  const [tier, setTier] = useState<1 | 2 | 3>(product.tier)
  const [series, setSeries] = useState(product.series ?? '')
  const [pricingMode, setPricingMode] = useState<'quote' | 'direct'>(product.pricing_mode)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteState, setDeleteState] = useState<DeleteState>({ phase: 'idle' })
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!modelName.trim()) { setError('모델명을 입력하세요'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/pricing/gpu/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_name: modelName.trim(),
          memory: memory.trim() || null,
          tier,
          series: series.trim() || null,
          pricing_mode: pricingMode,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? '수정 실패')
        return
      }
      mutateGpu(mutate)
      onSaved?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteConfirm = async (force: boolean) => {
    setDeleteState({ phase: 'busy', force })
    setDeleteError(null)
    try {
      const url = force
        ? `/api/pricing/gpu/products/${product.id}?force=true`
        : `/api/pricing/gpu/products/${product.id}`
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
      mutateGpu(mutate)
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
        aria-labelledby="prod-edit-title"
        className="gpu-modal-backdrop"
        onClick={onClose}
      >
        <div
          className="gpu-modal-card gpu-modal-card--md"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="gpu-modal-header">
            <span className="gpu-modal-header-icon">
              <Pencil size={14} />
            </span>
            <strong id="prod-edit-title" className="gpu-modal-title">
              상품 수정
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

          <div className="gpu-modal-body">
            <div>
              <label htmlFor="pe-model" className="gpu-field-label">
                모델명 <span className="gpu-field-required">*</span>
              </label>
              <input
                id="pe-model"
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                autoFocus
                className="gpu-field-input"
              />
            </div>

            <div className="gpu-form-grid-2">
              <div>
                <label htmlFor="pe-memory" className="gpu-field-label">VRAM</label>
                <input
                  id="pe-memory"
                  type="text"
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  placeholder="예: 80GB"
                  className="gpu-field-input"
                />
              </div>
              <div>
                <label htmlFor="pe-series" className="gpu-field-label">시리즈</label>
                <input
                  id="pe-series"
                  type="text"
                  value={series}
                  onChange={(e) => setSeries(e.target.value)}
                  placeholder="예: Hopper"
                  className="gpu-field-input"
                />
              </div>
            </div>

            <div className="gpu-form-grid-2">
              <div>
                <label htmlFor="pe-tier" className="gpu-field-label">Tier</label>
                <select
                  id="pe-tier"
                  value={tier}
                  onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}
                  className="gpu-field-input"
                >
                  <option value={1}>Tier 1 — 전용 고성능</option>
                  <option value={2}>Tier 2 — 점유형</option>
                  <option value={3}>Tier 3 — 간헐 공급</option>
                </select>
              </div>
              <div>
                <label htmlFor="pe-pricing-mode" className="gpu-field-label">가격 방식</label>
                <select
                  id="pe-pricing-mode"
                  value={pricingMode}
                  onChange={(e) => setPricingMode(e.target.value as 'quote' | 'direct')}
                  className="gpu-field-input"
                >
                  <option value="quote">quote — 견적 기반</option>
                  <option value="direct">direct — 직접 입력</option>
                </select>
              </div>
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
                  disabled={busy || !modelName.trim()}
                  className="gpu-btn gpu-btn-primary"
                >
                  {busy ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(deleteState.phase === 'confirm' || deleteState.phase === 'force' || deleteState.phase === 'busy') && (
        <ImpactDeleteDialog
          title="상품 삭제"
          subject={`${product.model_name}${product.memory ? ' ' + product.memory : ''} Tier ${product.tier}`}
          impactDetail={deleteState.phase === 'force' ? deleteState.impactDetail : undefined}
          forceMode={deleteState.phase === 'force'}
          busy={deleteState.phase === 'busy'}
          error={deleteError}
          onCancel={() => { setDeleteState({ phase: 'idle' }); setDeleteError(null) }}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </>
  )
}
