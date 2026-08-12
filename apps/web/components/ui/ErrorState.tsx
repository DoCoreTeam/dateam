// components/ui/ErrorState.tsx — 오류 상태 SSOT
//
// 왜: 오류를 "조용히 아무것도 안 보여주기"로 처리하면 사용자는 고장을 모른다.
//   원인 코드 · 다시 시도 · 도움 경로를 **함께** 보여준다.
//   CI 전용이던 구현을 공용으로 올렸다(도움 링크는 화면이 정한다 — 예전엔 /ci/settings 하드코딩).

import Link from 'next/link'
import type { ReactNode } from 'react'

export interface ErrorStateProps {
  /** 사용자에게 보일 한 줄 */
  message: string
  /** 원인 코드 — 문의할 때 이것만 있으면 추적된다 */
  code?: string
  onRetry?: () => void
  /** 도움 경로(설정 확인 등). 화면마다 다르므로 주입한다 */
  helpHref?: string
  helpLabel?: string
  children?: ReactNode
}

export default function ErrorState({
  message, code, onRetry, helpHref, helpLabel = '설정 확인', children,
}: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <strong>{message}</strong>
      {code && <span className="error-state-code">코드: {code}</span>}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
        {onRetry && (
          <button type="button" className="btn-ghost" onClick={onRetry}>다시 시도</button>
        )}
        {helpHref && <Link href={helpHref} className="btn-ghost">{helpLabel}</Link>}
      </div>
      {children}
    </div>
  )
}
