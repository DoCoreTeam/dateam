'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Menu, X, ChevronDown } from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  badge?: number
  highlight?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

interface MobileShellProps {
  items: NavItem[]
  groups?: NavGroup[]
  footer?: React.ReactNode
  logoUrl?: string | null
  brandName?: string
  headerLeft?: React.ReactNode
  headerRight?: React.ReactNode
  children: React.ReactNode
  adminHref?: string
}

export default function MobileShell({
  items,
  groups,
  footer,
  logoUrl,
  brandName = 'AX사업본부',
  headerLeft,
  headerRight,
  children,
  adminHref,
}: MobileShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hoveredHref, setHoveredHref] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const firstNavRef = useRef<HTMLAnchorElement>(null)

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // 라우트 변경 시 닫기
  useEffect(() => {
    closeMobile()
  }, [pathname, closeMobile])

  // body 스크롤 잠금
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
      // 드로어 열리면 첫 링크로 포커스
      setTimeout(() => firstNavRef.current?.focus(), 50)
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  // ESC 키 닫기
  useEffect(() => {
    if (!mobileOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMobile()
        hamburgerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobileOpen, closeMobile])

  return (
    <div className="app-shell">
      {/* 모바일 딤 오버레이 */}
      <div
        className={`sidebar-overlay${mobileOpen ? ' overlay-open' : ''}`}
        onClick={closeMobile}
        aria-hidden="true"
      />

      {/* 사이드바 */}
      <aside
        id="main-sidebar"
        className={`app-sidebar${mobileOpen ? ' sidebar-open' : ''}`}
        aria-label="주 사이드바"
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--nb-paper)',
          borderRight: 'var(--border-w) solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 브랜드 */}
        <div style={{
          padding: '1.25rem',
          borderBottom: '2px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.125rem', minWidth: 0 }}>
            <Link href="/home" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={brandName}
                  style={{ maxHeight: '32px', maxWidth: '160px', objectFit: 'contain' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <span style={{ color: 'var(--ink)', fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {brandName}
                </span>
              )}
            </Link>
            {/* 로고/브랜드 바로 아래 버전 */}
            <span style={{ fontSize: '0.625rem', color: '#6b6b6b', letterSpacing: '0.06em', fontWeight: 600 }}>
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? '—'}
            </span>
          </div>
          <button
            className="mobile-only-flex"
            onClick={closeMobile}
            aria-label="메뉴 닫기"
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--ink)', cursor: 'pointer',
              alignItems: 'center', padding: '0.25rem',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* 네비게이션 */}
        <nav style={{ flex: 1, padding: '0.75rem', overflowY: 'auto' }} aria-label="주 메뉴">
          {/* 기본 아이템 */}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            {items.map((item, idx) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
              const isHovered = hoveredHref === item.href && !isActive
              const isHighlight = item.highlight && !isActive
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    ref={idx === 0 ? firstNavRef : undefined}
                    onMouseEnter={() => setHoveredHref(item.href)}
                    onMouseLeave={() => setHoveredHref(null)}
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.625rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius)',
                      fontSize: '0.875rem',
                      fontWeight: isActive || isHighlight ? 700 : 500,
                      textDecoration: 'none',
                      transition: 'opacity 120ms, transform 120ms, border-color 120ms',
                      background: isActive
                        ? 'var(--accent)'
                        : isHighlight
                        ? 'var(--brand)'
                        : isHovered ? 'rgba(0,0,0,0.05)' : 'transparent',
                      border: isActive || isHighlight
                        ? '2px solid var(--border-color)'
                        : '2px solid transparent',
                      color: isActive ? 'var(--ink)' : isHighlight ? '#fff' : 'var(--ink)',
                      minHeight: '44px',
                      boxShadow: (isActive || isHighlight) ? 'var(--shadow-sm)' : 'none',
                      opacity: isHighlight && isHovered ? 0.9 : 1,
                      letterSpacing: isHighlight ? '0.01em' : undefined,
                    }}
                  >
                    <span style={{ flexShrink: 0, opacity: isActive || isHighlight ? 1 : 0.7, display: 'flex', alignItems: 'center' }}>
                      {item.icon}
                    </span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, lineHeight: 1,
                        backgroundColor: '#ef4444', color: '#fff',
                        borderRadius: '999px', padding: '0.2rem 0.4rem',
                        minWidth: '1.1rem', textAlign: 'center', flexShrink: 0,
                      }}>
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
          {/* 그룹 아이템 */}
          {groups?.map((group) => {
            const isCollapsed = collapsedGroups.has(group.label)
            const toggleGroup = () => setCollapsedGroups((prev) => {
              const next = new Set(prev)
              if (next.has(group.label)) next.delete(group.label)
              else next.add(group.label)
              return next
            })
            return (
              <div key={group.label} style={{ marginTop: '1rem' }}>
                <button
                  onClick={toggleGroup}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: '#6b6b6b',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    padding: '0.25rem 0.75rem',
                    margin: '0 0 0.25rem',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: '0.375rem',
                    transition: 'background-color 120ms',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(0,0,0,0.05)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
                >
                  {group.label}
                  <ChevronDown
                    size={12}
                    style={{ transition: 'transform 200ms', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {!isCollapsed && (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                    {group.items.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                      const isHovered = hoveredHref === item.href && !isActive
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onMouseEnter={() => setHoveredHref(item.href)}
                            onMouseLeave={() => setHoveredHref(null)}
                            aria-current={isActive ? 'page' : undefined}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.625rem',
                              padding: '0.5rem 0.75rem',
                              borderRadius: 'var(--radius)',
                              fontSize: '0.875rem',
                              fontWeight: isActive ? 700 : 500,
                              textDecoration: 'none',
                              transition: 'background-color 120ms, color 120ms, border-color 120ms',
                              backgroundColor: isActive ? 'var(--accent)' : isHovered ? 'rgba(0,0,0,0.05)' : 'transparent',
                              border: isActive ? '2px solid var(--border-color)' : '2px solid transparent',
                              color: 'var(--ink)',
                              boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                              minHeight: '44px',
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
                )}
              </div>
            )
          })}
        </nav>

        {/* 모바일 전용 어드민/멤버 전환 */}
        {adminHref && (
          <div className="mobile-only" style={{ padding: '0.5rem 0.75rem', borderTop: '2px solid var(--border-color)' }}>
            <Link
              href={adminHref}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0.625rem 1rem',
                borderRadius: 'var(--radius)',
                fontSize: '0.8125rem', fontWeight: 700,
                textDecoration: 'none',
                backgroundColor: 'var(--nb-white)',
                border: '2px solid var(--border-color)',
                boxShadow: 'var(--shadow-sm)',
                color: 'var(--ink)',
                minHeight: '44px',
              }}
            >
              {adminHref.startsWith('/admin') ? '관리자 패널 →' : '← 멤버 화면'}
            </Link>
          </div>
        )}

        {/* 푸터 */}
        {footer && (
          <div style={{ padding: '0.75rem', borderTop: '2px solid var(--border-color)' }}>
            {footer}
          </div>
        )}

      </aside>

      {/* 메인 영역 */}
      <div className="app-content">
        {/* 상단바 */}
        <header style={{
          height: '56px',
          backgroundColor: 'white',
          borderBottom: 'var(--border-w) solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 1.5rem',
          flexShrink: 0,
          gap: '0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 }}>
            {/* 모바일 햄버거 */}
            <button
              ref={hamburgerRef}
              className="mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="메뉴 열기"
              aria-expanded={mobileOpen}
              aria-controls="main-sidebar"
            >
              <Menu size={20} />
            </button>
            {headerLeft && (
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                {headerLeft}
              </div>
            )}
          </div>
          {headerRight && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
              {headerRight}
            </div>
          )}
        </header>

        {/* 콘텐츠 */}
        <main className="page-inner" style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--color-bg)' }}>
          {children}
        </main>
      </div>

      {/* 통합 입력 FAB — 모바일 전용 */}
      <Link
        href="/intake"
        className="intake-fab mobile-only-flex"
        aria-label="통합 입력"
        style={{ textDecoration: 'none' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </Link>
    </div>
  )
}
