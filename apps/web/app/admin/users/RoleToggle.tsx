'use client'

import { useTransition } from 'react'
import { changeRole } from './actions'
import { useAskDialog } from '@/components/ui/useAskDialog'

interface RoleToggleProps {
  userId: string
  currentRole: 'admin' | 'member'
  isSelf: boolean
}

export default function RoleToggle({ userId, currentRole, isSelf }: RoleToggleProps) {
  // 브라우저 기본 대화상자 대신 우리 모달 (정책 U-7)
  const { ask, dialog } = useAskDialog()
  const [isPending, startTransition] = useTransition()

  async function handleToggle() {
    if (isSelf) return
    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    if (!await ask.confirm({
      title: '역할을 바꿀까요?',
      body: newRole === 'admin'
        ? '관리자가 되면 모든 조직의 데이터와 설정에 닿을 수 있습니다.'
        : '일반 구성원이 되면 관리자 화면과 설정에 더 이상 닿지 못합니다.',
      confirmLabel: '변경', danger: newRole === 'admin',
    })) return
    startTransition(async () => { await changeRole(userId, newRole) })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending || isSelf}
      style={{
        padding: 'var(--space-1) var(--space-3)',
        borderRadius: 'var(--radius)',
        fontSize: 'var(--fs-xs)',
        fontWeight: 500,
        cursor: isSelf ? 'not-allowed' : 'pointer',
        opacity: isSelf || isPending ? 0.5 : 1,
        border: 'var(--hairline) solid',
        transition: 'all 120ms',
        backgroundColor: currentRole === 'admin' ? 'var(--danger-bg)' : 'var(--brand-soft)',
        borderColor: currentRole === 'admin' ? 'var(--danger-border)' : 'var(--brand-soft-2)',
        color: currentRole === 'admin' ? 'var(--danger)' : 'var(--brand-dark)',
      }}
      title={isSelf ? '본인 역할은 변경할 수 없습니다' : undefined}
    >
      {currentRole === 'admin' ? '→ member' : '→ admin'}
    {dialog}
    </button>
  )
}
