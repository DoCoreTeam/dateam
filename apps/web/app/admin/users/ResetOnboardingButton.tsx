'use client'

import { useState } from 'react'
import { resetUserOnboarding } from './actions'
import { Compass } from 'lucide-react'

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
    setDone(false)
    setError(null)
    const result = await resetUserOnboarding(userId)
    setLoading(false)
    if (result.ok) setDone(true)
    else setError(result.error)
  }

  if (done) {
    return <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--success)', fontWeight: 600 }}>초기화 완료</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <button
        onClick={handleReset}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          fontSize: 'var(--fs-xs)',
          color: 'var(--info)',
          background: 'var(--info-bg)',
          border: 'var(--hairline) solid var(--info-border)',
          borderRadius: 'var(--radius)',
          padding: '0.3rem 0.625rem',
          cursor: loading ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
          opacity: loading ? 0.6 : 1,
        }}
      >
        <Compass size={11} />
        {loading ? '처리중...' : '온보딩 초기화'}
      </button>
      {error && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}
