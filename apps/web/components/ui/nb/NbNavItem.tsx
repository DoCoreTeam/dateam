'use client'

import Link from 'next/link'
import type { Ref } from 'react'

// 사이드바 nav 항목 공용 컴포넌트 (SSOT).
// 3종 시각 규약: highlight=솔리드 brand CTA / active=아웃라인(보더+좌측 brand 바) / normal·hover.
// 이전엔 MobileShell 메인 ul·그룹 ul에 인라인 스타일이 중복·갈라져 있었음 → 단일 컴포넌트로 통일.

export interface NbNavItemProps {
  href: string
  label: string
  icon: React.ReactNode
  badge?: number
  isActive: boolean
  isHovered: boolean
  isHighlight?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  linkRef?: Ref<HTMLAnchorElement>
}

export default function NbNavItem({
  href, label, icon, badge, isActive, isHovered, isHighlight = false, onMouseEnter, onMouseLeave, linkRef,
}: NbNavItemProps) {
  // active가 우선 — active이면 highlight(CTA) 표현을 끈다(호출자 실수 방지 가드)
  const highlight = isHighlight && !isActive
  return (
    <Link
      href={href}
      ref={linkRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-current={isActive ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius)',
        fontSize: 'var(--fs-base)',
        fontWeight: isActive || highlight ? 700 : 500,
        textDecoration: 'none',
        transition: 'opacity 120ms, transform 120ms, border-color 120ms',
        // highlight=솔리드 brand 채움 CTA / active=채움 없는 아웃라인(좌측 brand 바)
        background: highlight
          ? 'var(--brand)'
          : isHovered && !isActive ? 'rgba(0,0,0,0.05)' : 'transparent',
        border: isActive
          ? 'var(--border-w-2) solid var(--border-color)'
          : 'var(--border-w-2) solid transparent',
        color: highlight ? '#fff' : 'var(--sidebar-fg)',
        minHeight: '44px',
        boxShadow: isActive
          ? 'inset 3px 0 0 var(--brand)'
          : highlight ? 'var(--shadow-sm)' : 'none',
        opacity: highlight && isHovered ? 0.9 : 1,
        letterSpacing: highlight ? '0.01em' : undefined,
      }}
    >
      <span style={{ flexShrink: 0, opacity: isActive || highlight ? 1 : 0.7, display: 'flex', alignItems: 'center' }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          fontSize: '0.6rem', fontWeight: 700, lineHeight: 1,
          backgroundColor: 'var(--danger)', color: '#fff',
          borderRadius: '999px', padding: '0.2rem 0.4rem',
          minWidth: '1.1rem', textAlign: 'center', flexShrink: 0,
        }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  )
}
