// components/ci/CiPageHeader.tsx — 페이지 헤더 표준 (CLAUDE.md §2-3)
// 페이지마다 h1을 인라인으로 자작하면 화면끼리 갈라진다. CI 전 화면이 이 컴포넌트만 쓴다.

import type { ReactNode } from 'react'

interface CiPageHeaderProps {
  title: string
  desc?: string
  actions?: ReactNode
  /** 그룹 내부 스테이지 내비 (리서치 1→2→3 등) */
  stageNav?: ReactNode
}

export default function CiPageHeader({ title, desc, actions, stageNav }: CiPageHeaderProps) {
  return (
    <header style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{
            fontSize: 'var(--fs-2xl)', fontWeight: 700,
            letterSpacing: '-0.03em', color: 'var(--text)', margin: 0,
          }}>
            {title}
          </h1>
          {desc && (
            <p style={{
              fontSize: 'var(--fs-sm)', color: 'var(--text-muted)',
              marginTop: 'var(--space-1)',
            }}>
              {desc}
            </p>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 'var(--space-2)' }}>{actions}</div>}
      </div>
      {stageNav && <div style={{ marginTop: 'var(--space-4)' }}>{stageNav}</div>}
    </header>
  )
}
