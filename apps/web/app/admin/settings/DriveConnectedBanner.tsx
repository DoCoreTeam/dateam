'use client'

import { useState, useEffect } from 'react'
import { CheckCircle, X } from 'lucide-react'

export default function DriveConnectedBanner() {
  const [visible, setVisible] = useState(true)

  // 3초 후 자동 숨김
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 3000)
    return () => clearTimeout(t)
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        backgroundColor: 'var(--success-bg)',
        border: '1px solid var(--success-border)',
        borderRadius: 'var(--radius)',
        fontSize: '0.875rem',
        fontWeight: 500,
        color: '#15803d',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <CheckCircle size={15} />
        Google Drive 연결이 완료되었습니다
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="알림 닫기"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0.125rem',
          color: 'var(--success)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
