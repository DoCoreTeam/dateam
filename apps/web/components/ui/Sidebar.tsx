'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
}

interface SidebarProps {
  items: NavItem[]
  footer?: React.ReactNode
  logoUrl?: string | null
  brandName?: string
}

export default function Sidebar({ items, footer, logoUrl, brandName = 'AX사업본부' }: SidebarProps) {
  const pathname = usePathname()
  const [hoveredHref, setHoveredHref] = useState<string | null>(null)

  return (
    <aside
      style={{
        width: '220px',
        minHeight: '100vh',
        backgroundColor: '#1e293b',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* 브랜드 */}
      <div
        style={{
          padding: '1.25rem 1.25rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Link href="/dashboard" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={brandName}
              style={{ maxHeight: '32px', maxWidth: '160px', objectFit: 'contain' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <span style={{ color: '#fff', fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
              {brandName}
            </span>
          )}
        </Link>
      </div>

      {/* 네비게이션 */}
      <nav style={{ flex: 1, padding: '0.75rem' }} aria-label="주 메뉴">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const isHovered = hoveredHref === item.href && !isActive
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onMouseEnter={() => setHoveredHref(item.href)}
                  onMouseLeave={() => setHoveredHref(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.625rem',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    textDecoration: 'none',
                    transition: 'background-color 120ms, color 120ms',
                    backgroundColor: isActive
                      ? '#4f46e5'
                      : isHovered
                      ? 'rgba(255,255,255,0.07)'
                      : 'transparent',
                    color: isActive || isHovered ? '#fff' : '#94a3b8',
                  }}
                >
                  <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: 'flex', alignItems: 'center' }}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* 푸터 */}
      {footer && (
        <div style={{ padding: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {footer}
        </div>
      )}

      {/* 버전 */}
      <div style={{ padding: '0.375rem 1rem 0.625rem', textAlign: 'center' }}>
        <span style={{ fontSize: '0.6875rem', color: '#475569', letterSpacing: '0.06em', fontWeight: 600 }}>
          v{process.env.NEXT_PUBLIC_APP_VERSION ?? '—'}
        </span>
      </div>
    </aside>
  )
}
