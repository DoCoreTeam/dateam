'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

interface DynamicKeyValueProps {
  name: string
  initialData: Record<string, unknown>
  addLabel?: string
}

const INPUT_SM: React.CSSProperties = {
  flex: 1,
  padding: '0.4rem 0.6rem',
  border: '2px solid var(--border-color)',
  borderRadius: '0.3rem',
  fontSize: '0.8125rem',
  color: 'var(--text)',
  background: '#fff',
  minWidth: 0,
}

export default function DynamicKeyValue({
  name,
  initialData,
  addLabel = '항목 추가',
}: DynamicKeyValueProps) {
  const [pairs, setPairs] = useState<{ k: string; v: string }[]>(
    Object.entries(initialData).map(([k, v]) => ({ k, v: String(v) }))
  )

  const value = Object.fromEntries(pairs.map((p) => [p.k, p.v]))

  function addPair() {
    setPairs((prev) => [...prev, { k: '', v: '' }])
  }

  function removePair(idx: number) {
    setPairs((prev) => prev.filter((_, i) => i !== idx))
  }

  function update(idx: number, field: 'k' | 'v', val: string) {
    setPairs((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p)))
  }

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(value)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.625rem' }}>
        {pairs.map((p, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              value={p.k}
              onChange={(e) => update(idx, 'k', e.target.value)}
              placeholder="키"
              style={{ ...INPUT_SM, maxWidth: '160px', fontWeight: 600 }}
            />
            <span style={{ color: 'var(--text-faint)', flexShrink: 0 }}>:</span>
            <input
              type="text"
              value={p.v}
              onChange={(e) => update(idx, 'v', e.target.value)}
              placeholder="값"
              style={INPUT_SM}
            />
            <button
              type="button"
              onClick={() => removePair(idx)}
              style={{
                padding: '0.3rem',
                border: 'none',
                borderRadius: '0.3rem',
                background: 'var(--danger-bg)',
                color: 'var(--danger)',
                cursor: 'pointer',
                flexShrink: 0,
                display: 'flex',
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addPair}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.375rem',
          padding: '0.375rem 0.75rem',
          border: '1px dashed #ddd6fe',
          borderRadius: '0.4rem',
          background: '#f5f3ff',
          color: 'var(--brand)',
          fontSize: '0.8125rem',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <Plus size={13} />
        {addLabel}
      </button>
    </div>
  )
}
