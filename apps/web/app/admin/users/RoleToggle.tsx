'use client'

import { useTransition } from 'react'
import { changeRole } from './actions'

interface RoleToggleProps {
  userId: string
  currentRole: 'admin' | 'member'
  isSelf: boolean
}

export default function RoleToggle({ userId, currentRole, isSelf }: RoleToggleProps) {
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    if (isSelf) return
    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    if (!confirm(`역할을 ${newRole}(으)로 변경하시겠습니까?`)) return
    startTransition(async () => { await changeRole(userId, newRole) })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending || isSelf}
      style={{
        padding: '0.25rem 0.75rem',
        borderRadius: 'var(--radius)',
        fontSize: '0.75rem',
        fontWeight: 500,
        cursor: isSelf ? 'not-allowed' : 'pointer',
        opacity: isSelf || isPending ? 0.5 : 1,
        border: '1px solid',
        transition: 'all 120ms',
        backgroundColor: currentRole === 'admin' ? 'var(--danger-bg)' : 'var(--brand-soft)',
        borderColor: currentRole === 'admin' ? 'var(--danger-border)' : '#ddd6fe',
        color: currentRole === 'admin' ? 'var(--danger)' : 'var(--brand-dark)',
      }}
      title={isSelf ? '본인 역할은 변경할 수 없습니다' : undefined}
    >
      {currentRole === 'admin' ? '→ member' : '→ admin'}
    </button>
  )
}
