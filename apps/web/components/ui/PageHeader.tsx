import type { ReactNode } from 'react'

// 공용 페이지 헤더 — 모든 (member) 페이지가 동일 제목 타이포/레이아웃을 쓰도록 단일화.
// 기준: 주간보고 헤더 토큰(--fs-2xl / 700 / letterSpacing -0.03em). raw <h1> 금지(§2-3).
interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  // 페이지별 여백 압축 등 추가 클래스(예: daily 상단 밀도 개선). 기본 동작은 불변.
  className?: string
  descClassName?: string
}

export default function PageHeader({ title, description, actions, className, descClassName }: PageHeaderProps) {
  return (
    <header
      className={className}
      style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-5)',
      }}
    >
      <div>
        <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>
          {title}
        </h1>
        {description && (
          <p className={descClassName} style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>{description}</p>
        )}
      </div>
      {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}
    </header>
  )
}
