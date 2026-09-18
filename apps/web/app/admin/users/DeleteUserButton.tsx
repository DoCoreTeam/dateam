'use client'

import { useState, useTransition } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import { deleteUser } from './actions'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import { eulReul } from '@/lib/ui/josa'

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
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>
          <AlertTriangle size={12} />
          {/* 조사는 계산한다 — 「을」을 박아 두면 받침 없는 이름에서 틀린다 */}
          <span><strong>{userName}</strong>{eulReul(userName)} 삭제합니까?</span>
        </span>
        <InlineError compact>{error}</InlineError>
        <span style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <NbButton type="button" variant="danger" onClick={handleDelete} disabled={pending}>
            {pending ? '삭제 중' : '확인'}
          </NbButton>
          <NbButton type="button" variant="secondary" onClick={() => { setConfirming(false); setError(null) }} disabled={pending}>
            취소
          </NbButton>
        </span>
      </span>
    )
  }

  return (
    // 목록 행과 구성원 상세에 같이 놓인다 — 모양을 자작하면 두 자리에서 크기가 갈린다(§2-5)
    <NbButton type="button" variant="danger-ghost" onClick={() => setConfirming(true)} title={`${userName} 삭제`}>
      <Trash2 size={13} /> 삭제
    </NbButton>
  )
}
