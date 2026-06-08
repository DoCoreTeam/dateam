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
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>삭제?</span>
        <button
          onClick={handleDelete}
          disabled={isPending}
          style={{
            padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius)',
            background: 'var(--danger)', color: 'white', border: 'none',
            fontSize: 'var(--fs-xs)', cursor: isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {isPending ? '...' : '확인'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          style={{
            padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius)',
            background: 'var(--surface-muted)', color: 'var(--text-muted)', border: 'none',
            fontSize: 'var(--fs-xs)', cursor: 'pointer',
          }}
        >
          취소
        </button>
        {error && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>{error}</span>}
      </span>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
        padding: '0.375rem 0.625rem', borderRadius: 'var(--radius)',
        background: 'var(--danger-bg)', color: 'var(--danger)',
        border: 'none', fontSize: 'var(--fs-sm)', cursor: 'pointer',
      }}
      title={`${tierName} 삭제`}
    >
      <Trash2 size={13} /> 삭제
    </button>
  )
}
