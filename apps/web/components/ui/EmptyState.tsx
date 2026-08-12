// components/ui/EmptyState.tsx — 빈 상태 SSOT
//
// 왜 이 구현인가:
//   빈 상태가 두 벌이었다. 정책(CLAUDE.md §2)은 이 파일을 "18건 사용"이라고 지정했지만
//   **실사용 18건은 `ci/states.tsx` 쪽**이었고 이 파일은 1건이었다(v0.7.443 실측).
//   그래서 이긴 구현(클래스 기반 + href 액션 + 보조 슬롯)을 여기로 올리고,
//   기존 API(icon·actionLabel·onAction)도 흡수해 양쪽 호출부를 모두 받는다.
//   스타일은 `.empty-state*` 클래스(globals.css) — 예전엔 `ci-empty`라 도메인에 묶여 보였다.
//
// 규칙: 데이터가 0건일 때 빈 화면으로 끝내지 않는다. **다음 행동을 하나 제시한다.**

import Link from 'next/link'
import type { ReactNode } from 'react'

export interface EmptyStateAction {
  label: string
  /** 이동이면 href, 실행이면 onClick */
  href?: string
  onClick?: () => void
}

export interface EmptyStateProps {
  /** 무엇이 없는지 — 한 줄 */
  title: string
  /** 어떻게 채우는지 — 쉬운 말로 */
  description?: ReactNode
  icon?: ReactNode
  /** 다음 행동 1개 */
  action?: EmptyStateAction
  /** 보조 안내·부가 링크 */
  secondary?: ReactNode
  /** @deprecated `action`을 쓴다. 기존 호출부 호환용 */
  actionLabel?: string
  /** @deprecated `action`을 쓴다. 기존 호출부 호환용 */
  onAction?: () => void
}

export default function EmptyState({
  title, description, icon, action, secondary, actionLabel, onAction,
}: EmptyStateProps) {
  const primary: EmptyStateAction | undefined =
    action ?? (actionLabel ? { label: actionLabel, onClick: onAction } : undefined)

  return (
    <div className="empty-state">
      {icon && <div style={{ color: 'var(--text-faint)' }}>{icon}</div>}
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
      {primary?.href && (
        <Link href={primary.href} className="btn-primary">{primary.label}</Link>
      )}
      {primary && !primary.href && (
        <button type="button" className="btn-primary" onClick={primary.onClick}>
          {primary.label}
        </button>
      )}
      {secondary}
    </div>
  )
}
