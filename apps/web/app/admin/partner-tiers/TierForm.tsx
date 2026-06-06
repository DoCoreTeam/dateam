'use client'

import { useState } from 'react'
import { createTier, updateTier } from './actions'
import { X, Save } from 'lucide-react'

type Mode = 'create' | 'edit'

interface TierFormProps {
  mode: Mode
  tierId?: string
  defaultName?: string
  defaultRate?: number
  defaultDescription?: string
  onCancel?: () => void
}

export default function TierForm({
  mode,
  tierId,
  defaultName = '',
  defaultRate = 0,
  defaultDescription = '',
  onCancel,
}: TierFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setPending(true)
    setError(null)

    const formData = new FormData(form)
    const result = mode === 'create'
      ? await createTier(formData)
      : await updateTier(tierId!, formData)

    if (result.error) {
      setError(result.error)
    } else if (mode === 'create') {
      form.reset()
    } else if (onCancel) {
      onCancel()
    }
    setPending(false)
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#475569', marginBottom: '0.25rem' }}>
            등급명 *
          </label>
          <input
            name="name"
            defaultValue={defaultName}
            placeholder="예: VIP, Gold, 파트너A"
            required
            style={{
              width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
              border: '2px solid var(--border-color)', fontSize: '0.875rem', boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: '0 1 120px' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#475569', marginBottom: '0.25rem' }}>
            할인율 (%) *
          </label>
          <input
            name="discount_rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            defaultValue={defaultRate}
            required
            style={{
              width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
              border: '2px solid var(--border-color)', fontSize: '0.875rem', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ flex: '2 1 200px' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#475569', marginBottom: '0.25rem' }}>
            설명 (선택)
          </label>
          <input
            name="description"
            defaultValue={defaultDescription}
            placeholder="등급 설명"
            style={{
              width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
              border: '2px solid var(--border-color)', fontSize: '0.875rem', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {error && (
        <p style={{ fontSize: '0.8125rem', color: '#dc2626', margin: 0 }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="submit"
          disabled={pending}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.5rem 1rem', borderRadius: '0.375rem',
            background: pending ? '#94a3b8' : 'var(--brand)', color: 'white',
            border: 'none', fontSize: '0.875rem', fontWeight: 500, cursor: pending ? 'not-allowed' : 'pointer',
          }}
        >
          <Save size={14} />
          {pending ? '저장 중...' : '저장'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
              background: 'transparent', color: '#64748b',
              border: '2px solid var(--border-color)', fontSize: '0.875rem', cursor: 'pointer',
            }}
          >
            <X size={14} />
            취소
          </button>
        )}
      </div>
    </form>
  )
}
