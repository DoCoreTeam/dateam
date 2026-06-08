'use client'

import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { useEscClose } from '@/lib/use-esc-close'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { STANDARD_LADDER } from '@/lib/gpu/config-ladder'
import { X, Plus } from 'lucide-react'

type GpuCount = (typeof STANDARD_LADDER)[number]

interface ProductAddModalProps {
  onClose: () => void
  onAdded?: () => void
}

export default function ProductAddModal({ onClose, onAdded }: ProductAddModalProps) {
  useEscClose(onClose)
  const { mutate } = useSWRConfig()

  const [modelName, setModelName] = useState('')
  const [memory, setMemory] = useState('')
  const [tier, setTier] = useState<1 | 2 | 3>(1)
  const [series, setSeries] = useState('')
  const [pricingMode, setPricingMode] = useState<'quote' | 'direct'>('quote')
  const [gpuCount, setGpuCount] = useState<GpuCount>(1)
  const [vcpu, setVcpu] = useState('')
  const [ramGb, setRamGb] = useState('')
  const [storageGb, setStorageGb] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modelName.trim()) { setError('모델명을 입력하세요'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/pricing/gpu/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_name: modelName.trim(),
          memory: memory.trim() || null,
          tier,
          series: series.trim() || null,
          pricing_mode: pricingMode,
          gpu_count: gpuCount,
          vcpu: vcpu ? Number(vcpu) : null,
          ram_gb: ramGb ? Number(ramGb) : null,
          storage_gb: storageGb ? Number(storageGb) : null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? '생성 실패')
        return
      }
      mutateGpu(mutate)
      onAdded?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-add-title"
      className="gpu-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="gpu-modal-card gpu-modal-card--lg gpu-modal-card--scroll"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="gpu-modal-header">
          <span className="gpu-modal-header-icon">
            <Plus size={15} />
          </span>
          <strong id="product-add-title" className="gpu-modal-title">
            GPU 상품 직접 등록
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

        <div
          role="form"
          aria-label="GPU 상품 등록"
          onSubmit={handleSubmit}
          className="gpu-modal-body"
        >
          {/* 모델명 */}
          <div>
            <label htmlFor="pa-model-name" className="gpu-field-label">
              모델명 <span className="gpu-field-required">*</span>
            </label>
            <input
              id="pa-model-name"
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="예: H100, B200, RTX 4090"
              required
              autoFocus
              className="gpu-field-input"
            />
          </div>

          {/* 메모리 + 시리즈 */}
          <div className="gpu-form-grid-2">
            <div>
              <label htmlFor="pa-memory" className="gpu-field-label">VRAM (예: 80GB)</label>
              <input
                id="pa-memory"
                type="text"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="80GB"
                className="gpu-field-input"
              />
            </div>
            <div>
              <label htmlFor="pa-series" className="gpu-field-label">시리즈 (선택)</label>
              <input
                id="pa-series"
                type="text"
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                placeholder="예: Hopper, Blackwell"
                className="gpu-field-input"
              />
            </div>
          </div>

          {/* Tier + pricing_mode */}
          <div className="gpu-form-grid-2">
            <div>
              <label htmlFor="pa-tier" className="gpu-field-label">
                Tier <span className="gpu-field-required">*</span>
              </label>
              <select
                id="pa-tier"
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
              <label htmlFor="pa-pricing-mode" className="gpu-field-label">가격 방식</label>
              <select
                id="pa-pricing-mode"
                value={pricingMode}
                onChange={(e) => setPricingMode(e.target.value as 'quote' | 'direct')}
                className="gpu-field-input"
              >
                <option value="quote">quote — 견적 기반</option>
                <option value="direct">direct — 직접 입력</option>
              </select>
            </div>
          </div>

          {/* GPU 수량 — STANDARD_LADDER 토글 */}
          <div>
            <label className="gpu-field-label">
              GPU 수량 <span className="gpu-field-required">*</span>
              <span className="gpu-field-hint">1·2·4·8만 선택 가능</span>
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

          {/* vCPU / RAM / Storage */}
          <div className="gpu-form-grid-3">
            <div>
              <label htmlFor="pa-vcpu" className="gpu-field-label">vCPU</label>
              <input
                id="pa-vcpu"
                type="number"
                min={0}
                value={vcpu}
                onChange={(e) => setVcpu(e.target.value)}
                placeholder="—"
                className="gpu-field-input"
              />
            </div>
            <div>
              <label htmlFor="pa-ram" className="gpu-field-label">RAM (GB)</label>
              <input
                id="pa-ram"
                type="number"
                min={0}
                value={ramGb}
                onChange={(e) => setRamGb(e.target.value)}
                placeholder="—"
                className="gpu-field-input"
              />
            </div>
            <div>
              <label htmlFor="pa-storage" className="gpu-field-label">SSD (GB)</label>
              <input
                id="pa-storage"
                type="number"
                min={0}
                value={storageGb}
                onChange={(e) => setStorageGb(e.target.value)}
                placeholder="—"
                className="gpu-field-input"
              />
            </div>
          </div>

          {error && <div className="gpu-field-error">{error}</div>}

          {/* 액션 */}
          <div className="gpu-modal-actions-end">
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
              onClick={handleSubmit}
              disabled={busy || !modelName.trim()}
              className="gpu-btn gpu-btn-primary"
            >
              {busy ? '등록 중…' : '상품 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
