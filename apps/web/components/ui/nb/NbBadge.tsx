// Neo-brutalism 공용 뱃지 — 디자인 SSOT.
// 상태 색은 globals.css .badge[data-status]가 토큰으로 적용(인라인 hex 제거 — 테마 자동 대응).
import type { ReactNode } from 'react'
import type { StatusKey } from '@/lib/tokens/status-colors'

interface NbBadgeProps {
  /** 상태 키를 주면 의미색(토큰) 적용, 없으면 기본 뱃지 */
  status?: StatusKey
  children: ReactNode
}

export default function NbBadge({ status, children }: NbBadgeProps) {
  return (
    <span className="badge" data-status={status || undefined}>
      {children}
    </span>
  )
}
