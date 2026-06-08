'use client'

import Link from 'next/link'
import type { Ref } from 'react'

// 사이드바 nav 항목 공용 컴포넌트 (SSOT).
// 3종 시각 규약(globals.css .nb-nav-item[data-state]): highlight=솔리드 brand CTA / active=아웃라인(보더+좌측 brand 바) / normal.
// hover는 CSS :hover(--nav-hover-bg, 테마별)로 처리 — JS hover 추적 불필요.

export interface NbNavItemProps {
  href: string
  label: string
  icon: React.ReactNode
  badge?: number
  isActive: boolean
  isHighlight?: boolean
  linkRef?: Ref<HTMLAnchorElement>
}

export default function NbNavItem({
  href, label, icon, badge, isActive, isHighlight = false, linkRef,
}: NbNavItemProps) {
  // active가 우선 — active이면 highlight(CTA) 표현을 끈다
  const state = isActive ? 'active' : isHighlight ? 'highlight' : 'normal'
  return (
    <Link
      href={href}
      ref={linkRef}
      aria-current={isActive ? 'page' : undefined}
      className="nb-nav-item"
      data-state={state}
    >
      <span className="nb-nav-item__icon">{icon}</span>
      <span className="nb-nav-item__label">{label}</span>
      {badge != null && badge > 0 && (
        <span className="nb-nav-badge">{badge > 9 ? '9+' : badge}</span>
      )}
    </Link>
  )
}
