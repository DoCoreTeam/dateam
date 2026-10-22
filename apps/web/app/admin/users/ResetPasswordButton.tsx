'use client'

import { useState } from 'react'
import { resetUserPassword } from './actions'
import { RefreshCw } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import { useAskDialog } from '@/components/ui/useAskDialog'
import TempPasswordReveal from './TempPasswordReveal'

interface Props {
  userId: string
  userEmail: string
  userName: string
}

export default function ResetPasswordButton({ userId, userEmail, userName }: Props) {
  // 브라우저 기본 대화상자 대신 우리 모달 (정책 U-7)
  const { ask, dialog } = useAskDialog()
  const [loading, setLoading] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleReset = async () => {
    if (!await ask.confirm({
      title: '비밀번호를 초기화할까요?',
      body: `${userName}님의 지금 비밀번호가 바로 쓸 수 없게 됩니다. 새 임시 비밀번호를 한 번만 보여 드립니다.`,
      confirmLabel: '초기화', danger: true,
    })) return
    setLoading(true)
    await withSubmitGuard(async () => {
      setTempPassword(null)
      setError(null)
      const result = await resetUserPassword(userId, userEmail)
      setLoading(false)
      if (result.ok) {
        setTempPassword(result.tempPassword)
      } else {
        setError(result.error)
      }
    }, { onError: setError, onDone: () => setLoading(false) })
  }

  if (tempPassword) return <TempPasswordReveal password={tempPassword} />

  return (
    // 목록 행과 구성원 상세에 같이 놓인다 — 모양을 자작하면 두 자리에서 크기가 갈린다(§2-5)
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <NbButton type="button" variant="secondary" onClick={handleReset} disabled={loading}>
        <RefreshCw size={13} />
        {loading ? '처리 중' : 'PW초기화'}
      </NbButton>
      <InlineError compact>{error}</InlineError>
    {dialog}
    </span>
  )
}
