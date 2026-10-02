'use client'

import { useState } from 'react'
import { resetUserOnboarding } from './actions'
import { Compass } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import { useAskDialog } from '@/components/ui/useAskDialog'

interface Props {
  userId: string
  userName: string
}

export default function ResetOnboardingButton({ userId, userName }: Props) {
  // 브라우저 기본 대화상자 대신 우리 모달 (정책 U-7)
  const { ask, dialog } = useAskDialog()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleReset = async () => {
    if (!await ask.confirm({
      title: '온보딩을 초기화할까요?',
      body: `${userName}님이 다음에 들어올 때 안내가 처음부터 다시 나옵니다. 다른 데이터는 그대로입니다.`,
      confirmLabel: '초기화',
    })) return
    setLoading(true)
    await withSubmitGuard(async () => {
      setDone(false)
      setError(null)
      const result = await resetUserOnboarding(userId)
      setLoading(false)
      if (result.ok) setDone(true)
      else setError(result.error)
    }, { onError: setError, onDone: () => setLoading(false) })
  }

  if (done) {
    return <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--success)', fontWeight: 600 }}>초기화 완료</span>
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <NbButton type="button" variant="secondary" onClick={handleReset} disabled={loading}>
        <Compass size={13} />
        {loading ? '처리 중' : '온보딩 초기화'}
      </NbButton>
      <InlineError compact>{error}</InlineError>
    {dialog}
    </span>
  )
}
