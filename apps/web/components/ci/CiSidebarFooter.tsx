'use client'

// components/ci/CiSidebarFooter.tsx — CI 사이드바 하단
// MobileShell의 footer 슬롯에 들어간다. 사내 업무로 돌아가는 길과 현재 워크스페이스만 보여준다.

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function CiSidebarFooter({ workspaceName }: { workspaceName: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <Link
        href="/home"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.625rem',
          padding: 'var(--space-2) var(--space-3)',
          fontSize: 'var(--fs-sm)', color: 'var(--sidebar-fg)',
          textDecoration: 'none', borderRadius: 'var(--radius)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--nav-hover-bg)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <ArrowLeft size={16} />
        사내 업무로
      </Link>
      <p
        style={{
          padding: '0 var(--space-3)',
          fontSize: 'var(--fs-2xs)',
          color: 'var(--sidebar-fg)',
          opacity: 0.7,
        }}
      >
        {workspaceName}
      </p>
    </div>
  )
}
