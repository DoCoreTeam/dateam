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
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleReset = async () => {
    if (!confirm(`${userName}님의 비밀번호를 초기화하시겠습니까?\n임시 비밀번호가 발급됩니다.`)) return
    setLoading(true)
    setTempPassword(null)
    setCopied(false)
    setError(null)
    const result = await resetUserPassword(userId, userEmail)
    setLoading(false)
    if (result.ok) {
      setTempPassword(result.tempPassword)
    } else {
      setError(result.error)
    }
  }

  const handleCopy = () => {
    if (!tempPassword) return
    navigator.clipboard.writeText(tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (tempPassword) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <span style={{ fontSize: '0.6875rem', color: '#16a34a', fontWeight: 600 }}>임시 비밀번호</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <code style={{
            fontSize: '0.6875rem',
            fontFamily: 'monospace',
            background: '#f1f5f9',
            padding: '0.2rem 0.4rem',
            borderRadius: '0.25rem',
            color: '#0f172a',
            letterSpacing: '0.05em',
          }}>
            {tempPassword}
          </code>
          <button
            onClick={handleCopy}
            style={{
              fontSize: '0.6875rem',
              color: copied ? '#16a34a' : '#6366f1',
              background: 'none',
              border: `1px solid ${copied ? '#16a34a' : '#6366f1'}`,
              borderRadius: '0.375rem',
              padding: '0.2rem 0.4rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {copied ? '복사됨' : '복사'}
          </button>
        </div>
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
