// components/ci/states.tsx — 5상태 공용 컴포넌트 (설계서 §6.6)
// 로딩=스켈레톤(스피너 금지) / 빈 상태=다음 행동 1개 / 부분 데이터=배지 /
// 오류=원인 코드+재시도+문의(침묵 실패 금지) / 정상=기준 병기
//
// 화면마다 빈 상태 마크업을 다시 짜지 않는다.

import Link from 'next/link'
import type { ReactNode } from 'react'

export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="ci-card-grid" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ci-content-card">
          <div className="ci-skeleton" style={{ aspectRatio: '16 / 9', width: '100%' }} />
          <div className="ci-card-body">
            <div className="ci-skeleton" style={{ height: '1rem', width: '90%' }} />
            <div className="ci-skeleton" style={{ height: '0.75rem', width: '60%' }} />
            <div className="ci-skeleton" style={{ height: '1.25rem', width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function RowSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ci-skeleton" style={{ height: '48px' }} />
      ))}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  /** 다음 행동을 반드시 하나 제시한다 */
  description: string
  action?: { label: string; href?: string; onClick?: () => void }
  secondary?: ReactNode
}

export function EmptyState({ title, description, action, secondary }: EmptyStateProps) {
  return (
    <div className="ci-empty">
      <p className="ci-empty-title">{title}</p>
      <p className="ci-empty-desc">{description}</p>
      {action?.href && (
        <Link href={action.href} className="btn-primary">{action.label}</Link>
      )}
      {action && !action.href && (
        <button type="button" className="btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {secondary}
    </div>
  )
}

interface ErrorStateProps {
  code: string
  message: string
  onRetry?: () => void
}

/** 오류는 원인 코드·재시도·문의 경로를 반드시 함께 보여준다. */
export function ErrorState({ code, message, onRetry }: ErrorStateProps) {
  return (
    <div className="ci-error" role="alert">
      <strong>{message}</strong>
      <span className="ci-error-code">코드: {code}</span>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
        {onRetry && (
          <button type="button" className="btn-ghost" onClick={onRetry}>다시 시도</button>
        )}
        <Link href="/ci/settings" className="btn-ghost">설정 확인</Link>
      </div>
    </div>
  )
}

/** 모집단이 얇아 통계를 낼 수 없을 때. 빈 상태와 구분한다 — 데이터는 있으나 부족한 것이다. */
export function InsufficientData({
  what, action,
}: { what: string; action?: { label: string; href: string } }) {
  return (
    <div className="ci-empty">
      <p className="ci-empty-title">아직 {what}를 계산할 만큼 데이터가 모이지 않았습니다</p>
      <p className="ci-empty-desc">
        비교 대상이 충분해지면 자동으로 표시됩니다. 그럴듯한 숫자를 지어내지 않습니다.
      </p>
      {action && <Link href={action.href} className="btn-primary">{action.label}</Link>}
    </div>
  )
}
