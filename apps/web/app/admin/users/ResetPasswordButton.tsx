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
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleReset = async () => {
    if (!confirm(`${userName}님의 비밀번호를 초기화하시겠습니까?`)) return
    setLoading(true)
    setLink(null)
    setError(null)
    const result = await resetUserPassword(userId, userEmail)
    setLoading(false)
    if (result.ok) {
      setLink(result.link)
    } else {
      setError(result.error)
    }
  }

  if (link) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <span style={{ fontSize: '0.6875rem', color: '#16a34a', fontWeight: 600 }}>초기화 완료</span>
        <button
          onClick={() => { navigator.clipboard.writeText(link); alert('링크가 복사되었습니다') }}
          style={{
            fontSize: '0.6875rem',
            color: '#6366f1',
            background: 'none',
            border: '1px solid #6366f1',
            borderRadius: '0.375rem',
            padding: '0.2rem 0.5rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          링크 복사
        </button>
      </div>
    )
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
          color: '#d97706',
          background: '#fffbeb',
          border: '1px solid #fde68a',
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
      {error && <span style={{ fontSize: '0.6875rem', color: '#dc2626' }}>{error}</span>}
    </div>
  )
}
