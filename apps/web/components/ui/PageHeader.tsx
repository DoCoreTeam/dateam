import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

// 공용 페이지 헤더 — 모든 (member) 페이지가 동일 제목 타이포/레이아웃을 쓰도록 단일화.
// 기준: 주간보고 헤더 토큰(--fs-2xl / 700 / letterSpacing -0.03em). raw <h1> 금지(§2-3).
interface PageHeaderProps {
  title: string
  /** 제목 왼쪽 아이콘 — 화면 정체성을 한 눈에 줄 때만 */
  icon?: ReactNode
  /** 상위로 돌아가는 링크. 하위 화면이 헤더를 통째로 자작하던 이유가 이 슬롯이 없어서였다 */
  back?: { href: string; label: string }
  /** 제목 위 한 줄 분류(예: '가격정책'). 화면이 속한 묶음을 밝힐 때만 쓴다 */
  eyebrow?: string
  description?: string
  actions?: ReactNode
  // 페이지별 여백 압축 등 추가 클래스(예: daily 상단 밀도 개선). 기본 동작은 불변.
  className?: string
  descClassName?: string
  /** 헤더 아래 줄 — 스테이지 내비·탭처럼 제목에 종속된 것만 넣는다 */
  below?: ReactNode
}

export default function PageHeader({ title, icon, back, eyebrow, description, actions, className, descClassName, below }: PageHeaderProps) {
  const header = (
    <header
      className={`page-header${className ? ` ${className}` : ''}`}
      style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-5)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        {back && (
          <Link
            href={back.href}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
              fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', textDecoration: 'none',
              marginBottom: 'var(--space-2)',
            }}
          >
            <ArrowLeft size={14} />
            {back.label}
          </Link>
        )}
        {eyebrow && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>{eyebrow}</div>
        )}
        <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {icon}
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
