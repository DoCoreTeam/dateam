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
  /** 헤더 아래 줄 — 스테이지 내비·탭처럼 제목에 종속된 것만 넣는다 */
  below?: ReactNode
}

export default function PageHeader({ title, description, actions, className, descClassName, below }: PageHeaderProps) {
  const header = (
    <header
      className={`page-header${className ? ` ${className}` : ''}`}
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
      {actions && <div className="page-header-actions" style={{ flexShrink: 0 }}>{actions}</div>}
    </header>
  )

  if (!below) return header
  // below가 있으면 헤더의 하단 여백을 아래 줄이 이어받는다(간격 두 번 주지 않기)
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      {header}
      <div style={{ marginTop: 'calc(var(--space-5) * -1 + var(--space-4))' }}>{below}</div>
    </div>
  )
}
