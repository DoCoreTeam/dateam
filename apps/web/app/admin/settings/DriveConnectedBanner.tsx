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
        padding: 'var(--space-3) var(--space-4)',
        backgroundColor: 'var(--success-bg)',
        border: 'var(--hairline) solid var(--success-border)',
        borderRadius: 'var(--radius)',
        fontSize: 'var(--fs-base)',
        fontWeight: 500,
        color: 'var(--success)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
