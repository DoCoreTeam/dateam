'use client'

import { useState } from 'react'
import { resetUserPassword } from './actions'
import { RefreshCw } from 'lucide-react'

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
    setDone(false)
    setError(null)
    const result = await resetUserPassword(userId, userEmail)
    setLoading(false)
    if (result.ok) {
      setDone(true)
    } else {
      setError(result.error)
    }
  }

  if (done) {
    return <span style={{ fontSize: '0.6875rem', color: 'var(--success)', fontWeight: 600 }}>초기화 완료</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <button
        onClick={handleReset}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          fontSize: '0.75rem',
          color: 'var(--warning)',
          background: 'var(--warning-bg)',
          border: '1px solid var(--warning-border)',
          borderRadius: '0.375rem',
          padding: '0.3rem 0.625rem',
          cursor: loading ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
          opacity: loading ? 0.6 : 1,
        }}
      >
        <RefreshCw size={11} />
        {loading ? '처리중...' : 'PW초기화'}
      </button>
      {error && <span style={{ fontSize: '0.6875rem', color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}
