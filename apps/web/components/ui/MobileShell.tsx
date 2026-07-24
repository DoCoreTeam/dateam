'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Menu, X, ChevronDown } from 'lucide-react'
import NbNavItem from './nb/NbNavItem'
import QuickAddFab from './QuickAddFab'
import ChangelogModal from './ChangelogModal'
import ScrollJumpButtons from './ScrollJumpButtons'
import { LATEST_CHANGELOG_VERSION, CHANGELOG_SEEN_KEY, isChangelogPending } from '@/lib/changelog/entries'


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
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [changelogNewOnly, setChangelogNewOnly] = useState(false)
  // 마지막으로 확인한 업데이트 버전. undefined=localStorage 미독(하이드레이션 전), null=처음.
  const [seenVersion, setSeenVersion] = useState<string | null | undefined>(undefined)
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? ''

  // 미확인 신규 업데이트 존재 여부(N 배지·자동 안내 기준).
  const hasNewChangelog = seenVersion !== undefined && isChangelogPending(seenVersion)

  // 첫 접속 시 1회: 마지막 확인 이후 신규 업데이트가 있으면 '새 소식' 모달 자동 안내.
  useEffect(() => {
    let seen: string | null = null
    try { seen = localStorage.getItem(CHANGELOG_SEEN_KEY) } catch { /* SSR/프라이빗 모드 무시 */ }
    setSeenVersion(seen)
    if (isChangelogPending(seen)) {
      setChangelogNewOnly(true)
      setChangelogOpen(true)
    }
  }, [])

  // 모달 닫기 = 최신 버전을 '확인함'으로 기록 → N 배지 제거 + 재안내 안 함.
  const closeChangelog = useCallback(() => {
    setChangelogOpen(false)
    if (LATEST_CHANGELOG_VERSION) {
      try { localStorage.setItem(CHANGELOG_SEEN_KEY, LATEST_CHANGELOG_VERSION) } catch { /* 무시 */ }
      setSeenVersion(LATEST_CHANGELOG_VERSION)
    }
  }, [])

  const openChangelogFull = useCallback(() => { setChangelogNewOnly(false); setChangelogOpen(true) }, [])
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const firstNavRef = useRef<HTMLAnchorElement>(null)
  const mainRef = useRef<HTMLElement>(null)

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
            {/* 로고/브랜드 바로 아래 버전 — 클릭 시 업데이트 내역 모달 */}
            <button
              type="button"
              onClick={openChangelogFull}
              aria-label={hasNewChangelog ? '새 업데이트 내역 보기' : '업데이트 내역 보기'}
              title="업데이트 내역"
              className="app-version-btn"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontSize: '0.625rem', color: 'var(--text-muted)', letterSpacing: '0.06em', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              v{appVersion || '—'}
              {hasNewChangelog && (
                <span
                  aria-label="새 업데이트"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '16px', height: '16px', padding: '0 4px', borderRadius: '9999px', background: 'var(--danger)', color: '#fff', fontSize: 'var(--fs-2xs)', fontWeight: 700, lineHeight: 1, letterSpacing: 0 }}
                >
                  N
                </span>
              )}
            </button>
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
        <nav id="onboarding-sidebar-nav" style={{ flex: 1, padding: 'var(--space-3)', overflowY: 'auto' }} aria-label="주 메뉴">
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

        {/* 푸터 — 사용자 계정. 상·하 여백 확보(바닥에 딱 붙지 않도록) + 수직 중앙 정렬. */}
        {footer && (
          <div style={{ padding: 'var(--space-4)', borderTop: 'var(--border-w-2) solid var(--sidebar-divider)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
        <main ref={mainRef} className="page-inner" style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--color-bg)' }}>
          {children}
        </main>
      </div>

      {/* 전역 스크롤 점프(맨 위/맨 아래) — 긴 페이지 기본 UX */}
      <ScrollJumpButtons targetRef={mainRef} />

      {/* 빠른 추가 FAB — 하이브리드 speed-dial(맥락 강조 + 멀티). 데스크탑·모바일 */}
      <QuickAddFab isAdmin={isAdmin} />
      {changelogOpen && (
        <ChangelogModal
          currentVersion={appVersion}
          newOnly={changelogNewOnly}
          seenVersion={seenVersion ?? null}
          onClose={closeChangelog}
        />
      )}
    </div>
  )
}
