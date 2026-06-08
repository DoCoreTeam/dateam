'use client'

import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { useEscClose } from '@/lib/use-esc-close'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { X, Plus } from 'lucide-react'

const GPU_COUNT_OPTIONS = [1, 2, 4, 8] as const
type GpuCount = (typeof GPU_COUNT_OPTIONS)[number]

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
          width: 'min(520px, 100%)',
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
            <Plus size={15} />
          </span>
          <strong id="product-add-title" style={{ fontSize: 'var(--fs-base)', flex: 1 }}>
            GPU 상품 직접 등록
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

        <div
          role="form"
          aria-label="GPU 상품 등록"
          onSubmit={handleSubmit}
          style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          {/* 모델명 */}
          <div>
            <label
              htmlFor="pa-model-name"
              style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}
            >
              모델명 <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              id="pa-model-name"
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="예: H100, B200, RTX 4090"
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

          {/* 메모리 + 시리즈 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label htmlFor="pa-memory" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                VRAM (예: 80GB)
              </label>
              <input
                id="pa-memory"
                type="text"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="80GB"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)',
                }}
              />
            </div>
            <div>
              <label htmlFor="pa-series" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                시리즈 (선택)
              </label>
              <input
                id="pa-series"
                type="text"
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                placeholder="예: Hopper, Blackwell"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)',
                }}
              />
            </div>
          </div>

          {/* Tier + pricing_mode */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label htmlFor="pa-tier" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Tier <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <select
                id="pa-tier"
                value={tier}
                onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}
                style={{
                  width: '100%', height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)', background: '#fff',
                }}
              >
                <option value={1}>Tier 1 — 전용 고성능</option>
                <option value={2}>Tier 2 — 점유형</option>
                <option value={3}>Tier 3 — 간헐 공급</option>
              </select>
            </div>
            <div>
              <label htmlFor="pa-pricing-mode" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                가격 방식
              </label>
              <select
                id="pa-pricing-mode"
                value={pricingMode}
                onChange={(e) => setPricingMode(e.target.value as 'quote' | 'direct')}
                style={{
                  width: '100%', height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)', background: '#fff',
                }}
              >
                <option value="quote">quote — 견적 기반</option>
                <option value="direct">direct — 직접 입력</option>
              </select>
            </div>
          </div>

          {/* GPU 수량 — 1·2·4·8 select만 허용 */}
          <div>
            <label htmlFor="pa-gpu-count" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              GPU 수량 <span style={{ color: 'var(--danger)' }}>*</span>
              <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 6, color: 'var(--text-faint)' }}>1·2·4·8만 선택 가능</span>
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
                    fontSize: 'var(--fs-sm)', cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  ×{n}
                </button>
              ))}
            </div>
          </div>

          {/* vCPU / RAM / Storage */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
            <div>
              <label htmlFor="pa-vcpu" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                vCPU
              </label>
              <input
                id="pa-vcpu"
                type="number"
                min={0}
                value={vcpu}
                onChange={(e) => setVcpu(e.target.value)}
                placeholder="—"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)',
                }}
              />
            </div>
            <div>
              <label htmlFor="pa-ram" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                RAM (GB)
              </label>
              <input
                id="pa-ram"
                type="number"
                min={0}
                value={ramGb}
                onChange={(e) => setRamGb(e.target.value)}
                placeholder="—"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)',
                }}
              />
            </div>
            <div>
              <label htmlFor="pa-storage" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                SSD (GB)
              </label>
              <input
                id="pa-storage"
                type="number"
                min={0}
                value={storageGb}
                onChange={(e) => setStorageGb(e.target.value)}
                placeholder="—"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  height: 40, fontSize: 'var(--fs-sm)',
                  border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius)',
                  padding: '0 var(--space-3)',
                }}
              />
            </div>
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
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', paddingTop: 'var(--space-2)' }}>
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
              onClick={handleSubmit}
              disabled={busy || !modelName.trim()}
              className="gpu-btn gpu-btn-primary"
              style={{
                minHeight: 44,
                opacity: busy || !modelName.trim() ? 0.7 : 1,
                cursor: busy || !modelName.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? '등록 중…' : '상품 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
