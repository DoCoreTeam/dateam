'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteTier } from './actions'

export default function DeleteTierButton({ tierId, tierName }: { tierId: string; tierName: string }) {
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteTier(tierId)
      if (result.error) {
        setError(result.error)
        setConfirming(false)
      }
    })
  }

  if (confirming) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>삭제?</span>
        <button
          onClick={handleDelete}
          disabled={isPending}
          style={{
            padding: '0.25rem 0.5rem', borderRadius: 'var(--radius)',
            background: 'var(--danger)', color: 'white', border: 'none',
            fontSize: '0.75rem', cursor: isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {isPending ? '...' : '확인'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          style={{
            padding: '0.25rem 0.5rem', borderRadius: 'var(--radius)',
            background: 'var(--surface-muted)', color: 'var(--text-muted)', border: 'none',
            fontSize: '0.75rem', cursor: 'pointer',
          }}
        >
          취소
        </button>
        {error && <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{error}</span>}
      </span>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.25rem',
        padding: '0.375rem 0.625rem', borderRadius: 'var(--radius)',
        background: 'var(--danger-bg)', color: 'var(--danger)',
        border: 'none', fontSize: '0.8125rem', cursor: 'pointer',
      }}
      title={`${tierName} 삭제`}
    >
      <Trash2 size={13} /> 삭제
    </button>
  )
}
