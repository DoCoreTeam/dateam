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
  /**
   * 배지가 **무엇을 세는지**. 숫자만 있으면 사용자는 눌러 보고서야 뜻을 안다
   * (사용자 지적 2026-09-09: 「배지숫자가 있어서 눌렀는데 뭐가 뜬건지 알 수 있는 방법이 없구만」).
   * `lib/terms/badge.ts` 의 `badgeTitle()` 로 만든다 — 화면이 문장을 짓지 않는다.
   */
  badgeTitle?: string
  isActive: boolean
  isHighlight?: boolean
  linkRef?: Ref<HTMLAnchorElement>
}

export default function NbNavItem({
  href, label, icon, badge, badgeTitle, isActive, isHighlight = false, linkRef,
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
        // 뜻을 화면에 남긴다 — 마우스에는 title, 낭독기에는 aria-label.
        // 숫자만 읽히면 「업무 1」이 되어 무엇이 1건인지 알 길이 없다.
        <span className="nb-nav-badge" title={badgeTitle} aria-label={badgeTitle}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  )
}
