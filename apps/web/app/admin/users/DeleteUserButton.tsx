'use client'

import { useState, useTransition } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import { deleteUser } from './actions'

interface DeleteUserButtonProps {
  userId: string
  userName: string
  isSelf: boolean
}

export default function DeleteUserButton({ userId, userName, isSelf }: DeleteUserButtonProps) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (isSelf) return null

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteUser(userId)
      if (result.error) {
        setError(result.error)
        setConfirming(false)
      }
    })
  }

  if (confirming) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--danger)' }}>
          <AlertTriangle size={12} />
          <span><strong>{userName}</strong>을 삭제합니까?</span>
        </div>
        {error && <p style={{ fontSize: '0.75rem', color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <button
            onClick={handleDelete}
            disabled={pending}
            style={{
              padding: '0.25rem 0.625rem', fontSize: '0.75rem', fontWeight: 600,
              backgroundColor: 'var(--danger)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
            }}
          >
            {pending ? '삭제 중...' : '확인'}
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null) }}
            disabled={pending}
            style={{
              padding: '0.25rem 0.625rem', fontSize: '0.75rem',
              backgroundColor: 'var(--surface-muted)', color: 'var(--text-muted)',
              border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
            }}
          >
            취소
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title={`${userName} 삭제`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
        padding: '0.25rem 0.625rem', fontSize: '0.75rem',
        backgroundColor: 'var(--danger-bg)', color: 'var(--danger)',
        border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', cursor: 'pointer',
      }}
    >
      <Trash2 size={12} />
      삭제
    </button>
  )
}
