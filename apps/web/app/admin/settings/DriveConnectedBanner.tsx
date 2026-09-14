'use client'

import { useState, useEffect } from 'react'
import { CheckCircle, X } from 'lucide-react'
import StatusPill from '@/components/ui/settings/StatusPill'

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
        gap: 'var(--space-2)',
      }}
    >
      <StatusPill tone="ok">
        <CheckCircle size={12} />
        Google Drive 연결이 완료되었습니다
      </StatusPill>
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
