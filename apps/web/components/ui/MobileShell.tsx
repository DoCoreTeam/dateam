'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Menu, X, ChevronDown } from 'lucide-react'
import NbNavItem from './nb/NbNavItem'
import QuickAddFab from './QuickAddFab'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  badge?: number
  highlight?: boolean
  /** 추가로 active 처리할 경로들 (예: "업무"=/work가 /daily·/dept-tasks·/weekly-report에서도 강조) */
  match?: string[]
}

// 와이드 페이지(표/그리드 多) — 콘텐츠 폭 클램프(1200) 예외. 그 외 전 페이지는 1200 통일.

// 메뉴 항목 active 판정 — href 또는 match 경로 중 하나에 매칭
function isNavActive(pathname: string, item: NavItem): boolean {
  const paths = [item.href, ...(item.match ?? [])]
  return paths.some((p) => pathname === p || pathname.startsWith(p + '/'))
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
  isAdmin?: boolean
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
  isAdmin = false,
}: MobileShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
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
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: 'var(--border-w) solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 브랜드 — 상단 헤더와 하단 보더선 정렬: 동일 높이·동일 보더두께·수직중앙 */}
        <div style={{
          height: 'var(--header-height)',
          flexShrink: 0,
          padding: '0 var(--space-5)',
          borderBottom: 'var(--border-w) solid var(--sidebar-divider)',
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
                <span className="font-tape" style={{ color: 'var(--sidebar-fg)', fontSize: 'var(--brand-logo-size)', fontWeight: 700, letterSpacing: '0', lineHeight: 1 }}>
                  {brandName}
                </span>
              )}
            </Link>
            {/* 로고/브랜드 바로 아래 버전 */}
            <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', letterSpacing: '0.06em', fontWeight: 600 }}>
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? '—'}
            </span>
          </div>
          <button
            className="mobile-only-flex"
            onClick={closeMobile}
            aria-label="메뉴 닫기"
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--sidebar-fg)', cursor: 'pointer',
              alignItems: 'center', padding: 'var(--space-1)',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* 네비게이션 */}
        <nav style={{ flex: 1, padding: 'var(--space-3)', overflowY: 'auto' }} aria-label="주 메뉴">
          {/* 기본 아이템 */}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            {items.map((item, idx) => {
              const isActive = isNavActive(pathname, item)
              return (
                <li key={item.href}>
                  <NbNavItem
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    badge={item.badge}
                    isActive={isActive}
                    isHighlight={!!item.highlight && !isActive}
                    linkRef={idx === 0 ? firstNavRef : undefined}
                  />
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
                    padding: 'var(--space-1) var(--space-2)',
                    margin: '0 0 0.375rem',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <span className="tape-mini">{group.label}</span>
                  <ChevronDown
                    size={12}
                    style={{ transition: 'transform 200ms', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {!isCollapsed && (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                    {group.items.map((item) => {
                      const isActive = isNavActive(pathname, item)
                      return (
                        <li key={item.href}>
                          <NbNavItem
                            href={item.href}
                            label={item.label}
                            icon={item.icon}
                            badge={item.badge}
                            isActive={isActive}
                          />
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
          <div className="mobile-only" style={{ padding: 'var(--space-2) var(--space-3)', borderTop: 'var(--border-w-2) solid var(--sidebar-divider)' }}>
            <Link
              href={adminHref}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0.625rem 1rem',
                borderRadius: 'var(--radius)',
                fontSize: 'var(--fs-sm)', fontWeight: 700,
                textDecoration: 'none',
                backgroundColor: 'var(--nb-white)',
                border: 'var(--border-w-2) solid var(--border-color)',
                boxShadow: 'var(--shadow-sm)',
                color: 'var(--text)',
                minHeight: '44px',
              }}
            >
              {adminHref.startsWith('/admin') ? '관리자 패널 →' : '← 멤버 화면'}
            </Link>
          </div>
        )}

        {/* 푸터 */}
        {footer && (
          <div style={{ padding: 'var(--space-3)', borderTop: 'var(--border-w-2) solid var(--sidebar-divider)' }}>
            {footer}
          </div>
        )}

      </aside>

      {/* 메인 영역 */}
      <div className="app-content">
        {/* 상단바 */}
        <header style={{
          height: 'var(--header-height)',
          backgroundColor: 'var(--color-bg)',
          borderBottom: 'var(--border-w) solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-0) var(--space-6)',
          flexShrink: 0,
          gap: 'var(--space-3)',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
              {headerRight}
            </div>
          )}
        </header>

        {/* 콘텐츠 — page-inner가 전 페이지 공통 컨테이너(full-width 반응형, 폭 제한 없음) */}
        <main className="page-inner" style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--color-bg)' }}>
          {children}
        </main>
      </div>

      {/* 빠른 추가 FAB — 하이브리드 speed-dial(맥락 강조 + 멀티). 데스크탑·모바일 */}
      <QuickAddFab isAdmin={isAdmin} />
    </div>
  )
}
