// Neo-brutalism 공용 뱃지 — 디자인 SSOT.
// 상태 뱃지는 status-colors SSOT의 의미색 + NB 잉크 보더로 통일.
import type { ReactNode } from 'react'
import { STATUS_COLORS, type StatusKey } from '@/lib/tokens/status-colors'

interface NbBadgeProps {
  /** 상태 키를 주면 의미색 적용, 없으면 기본(노랑 accent) */
  status?: StatusKey
  children: ReactNode
}

export default function NbBadge({ status, children }: NbBadgeProps) {
  const c = status ? STATUS_COLORS[status] : null
  return (
    <span
      className="badge"
      style={c ? { background: c.bg, color: c.color } : undefined}
    >
      {children}
    </span>
  )
}
