'use client'

import { useState } from 'react'
import { createTier, updateTier } from './actions'
import { X, Save } from 'lucide-react'
import { withSubmitGuard } from '@/lib/forms/submit-guard'

type Mode = 'create' | 'edit'

interface TierFormProps {
  mode: Mode
  tierId?: string
  defaultName?: string
  defaultRate?: number
  defaultDescription?: string
  onCancel?: () => void
  onSaved?: () => void
}

export default function TierForm({
  mode,
  tierId,
  defaultName = '',
  defaultRate = 0,
  defaultDescription = '',
  onCancel,
  onSaved,
}: TierFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setPending(true)
    await withSubmitGuard(async () => {
      setError(null)

      const formData = new FormData(form)
      const result = mode === 'create'
        ? await createTier(formData)
        : await updateTier(tierId!, formData)

      if (result.error) {
        setError(result.error)
      } else if (mode === 'create') {
        form.reset()
        onSaved?.()
      } else {
        onSaved?.()
        onCancel?.()
      }
      setPending(false)
    }, { onError: setError, onDone: () => setPending(false) })
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <label htmlFor={`tier-name-${tierId ?? 'new'}`} className="label">등급명 *</label>
          <input id={`tier-name-${tierId ?? 'new'}`} name="name" className="input-field"
            defaultValue={defaultName}
            placeholder="예: VIP, Gold, 파트너A"
            required
          />
        </div>
        <div style={{ flex: '0 1 120px' }}>
          <label htmlFor={`tier-rate-${tierId ?? 'new'}`} className="label">할인율 (%) *</label>
          <input id={`tier-rate-${tierId ?? 'new'}`} name="discount_rate" className="input-field"
            type="number"
            min="0"
            max="100"
            step="0.01"
            defaultValue={defaultRate}
            required
          />
        </div>
        <div style={{ flex: '2 1 200px' }}>
          <label htmlFor={`tier-desc-${tierId ?? 'new'}`} className="label">설명 (선택)</label>
          <input id={`tier-desc-${tierId ?? 'new'}`} name="description" className="input-field"
            defaultValue={defaultDescription}
            placeholder="등급 설명"
          />
        </div>
      </div>

      {error && (
        <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)', margin: 0 }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn-primary" disabled={pending}>
          <Save size={14} />
          {pending ? '저장 중' : '저장'}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            <X size={14} />
            취소
          </button>
        )}
      </div>
    </form>
  )
}
