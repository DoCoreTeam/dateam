'use client'

import { useState } from 'react'
import { resetUserPassword } from './actions'
import { RefreshCw } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import NbButton from '@/components/ui/nb/NbButton'
import { withSubmitGuard } from '@/lib/forms/submit-guard'

interface Props {
  userId: string
  userEmail: string
  userName: string
}

export default function ResetPasswordButton({ userId, userEmail, userName }: Props) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleReset = async () => {
    if (!confirm(`${userName}님의 비밀번호를 초기화하시겠습니까?\n이후 빈 비밀번호로 로그인하면 새 비밀번호를 설정하게 됩니다.`)) return
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
    </span>
  )
}
