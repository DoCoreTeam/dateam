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
        <button type="button" className="btn-primary" onClick={handleDelete} disabled={isPending}
          style={{ backgroundColor: 'var(--danger)', color: 'var(--danger-fg)', padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--fs-xs)' }}
        >
          {isPending ? '삭제 중' : '확인'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}
          style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--fs-xs)' }}
        >
          취소
        </button>
        {error && <span role="alert" style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>{error}</span>}
      </span>
    )
  }

  return (
    <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}
      style={{ color: 'var(--danger)', padding: '0.375rem 0.625rem', fontSize: 'var(--fs-sm)' }}
      title={`${tierName} 삭제`}
    >
      <Trash2 size={13} /> 삭제
    </button>
  )
}
