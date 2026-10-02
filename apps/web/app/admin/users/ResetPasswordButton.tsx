'use client'

import { useState } from 'react'
import { resetUserPassword } from './actions'
import { RefreshCw } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import { useAskDialog } from '@/components/ui/useAskDialog'

interface Props {
  userId: string
  userEmail: string
  userName: string
}

export default function ResetPasswordButton({ userId, userEmail, userName }: Props) {
  // 브라우저 기본 대화상자 대신 우리 모달 (정책 U-7)
  const { ask, dialog } = useAskDialog()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleReset = async () => {
    if (!await ask.confirm({
      title: '비밀번호를 초기화할까요?',
      body: `${userName}님의 지금 비밀번호가 바로 쓸 수 없게 됩니다. 빈 비밀번호로 들어와 새로 정하게 됩니다.`,
      confirmLabel: '초기화', danger: true,
    })) return
    setLoading(true)
    await withSubmitGuard(async () => {
      setDone(false)
      setError(null)
      const result = await resetUserPassword(userId, userEmail)
      setLoading(false)
      if (result.ok) {
        setDone(true)
      } else {
        setError(result.error)
      }
    }, { onError: setError, onDone: () => setLoading(false) })
  }

  if (done) {
    return <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--success)', fontWeight: 600 }}>초기화 완료</span>
  }

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
