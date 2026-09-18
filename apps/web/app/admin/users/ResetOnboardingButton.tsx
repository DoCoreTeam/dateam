'use client'

import { useState } from 'react'
import { resetUserOnboarding } from './actions'
import { Compass } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import { withSubmitGuard } from '@/lib/forms/submit-guard'

interface Props {
  userId: string
  userName: string
}

export default function ResetOnboardingButton({ userId, userName }: Props) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleReset = async () => {
    if (!confirm(`${userName}님의 온보딩을 초기화하시겠습니까?\n다음 로그인 시 온보딩 가이드가 다시 표시됩니다.`)) return
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
    </span>
  )
}
