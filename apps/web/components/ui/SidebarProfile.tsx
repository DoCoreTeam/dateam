'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { KeyRound, LogOut, ChevronUp, LayoutDashboard, Code2, BookOpen, Palette, Check, ChevronRight, Sparkles, SlidersHorizontal } from 'lucide-react'
import { surfaceOf, adminEntryFor } from '@/lib/nav/surface'
import { THEMES, type ThemeId } from '@/lib/themes'
import { clearPersistedSwrCache } from '@/lib/swr-persist'
import styles from './sidebar-profile.module.css'

interface SidebarProfileProps {
  name: string
  email: string
  isAdmin?: boolean
  currentTheme?: ThemeId
  defaultTheme?: ThemeId
  /**
   * 이 표면의 **설정** 링크들. «내 계정»과 구분선으로 나뉘어 위에 붙는다.
   *
   * 왜 여기인가: 영업 단계·멤버·설정은 처음 한 번 정하고 가끔 손보는 것이다.
   * 매일 쓰는 것 옆(사이드바)에 두면 매일 쓰는 것이 안 보인다
   * (기획 `docs/2026-08-27-crm-capture-first` 설계 3).
   * **지우는 게 아니라 옮기는 것** — 링크는 그대로 살아 있다.
   */
  settingsItems?: readonly { href: string; label: string }[]
  /** 그 묶음의 이름. 무엇의 설정인지 안 밝히면 «내 계정» 설정으로 읽힌다 */
  settingsLabel?: string
}

export default function SidebarProfile({ name, email, isAdmin = false, currentTheme, defaultTheme, settingsItems, settingsLabel }: SidebarProfileProps) {
  const pathname = usePathname()
  // 관리자 화면 안에서는 나가는 길이 필요하다 — 예전 AdminUserMenu가 하던 일.
  // 셸이 하나로 합쳐졌으니 계정 메뉴가 위치에 맞는 링크를 고른다.
  /**
   * 지금 어느 표면에 있나 — 판정은 SSOT 가 한다(`lib/nav/surface.ts`).
   *
   * 예전엔 여기서 `pathname.startsWith('/admin')` 한 줄로 끝냈다. 그래서
   * CRM·CI 에서는 계정 메뉴에 **나가는 문이 아니라 관리자 패널로 들어가는 문**이 떴고,
   * 그마저 관리자 전용이라 **일반 멤버는 갈 곳이 0개**였다
   * (사용자 지적 2026-08-24: "CRM에서는 멤버화면 가는 메뉴가 안나오면 되겠니?").
   */
  const surface = surfaceOf(pathname)
  /**
   * 나가는 문은 여기 없다 — **사이드바 하단 한 자리**로 옮겼다(§2-3-3 N-2 · `ShellExit`).
   * 여기 두면 같은 곳으로 가는 문이 두 개가 되고, 문구가 다르면 **다른 곳으로 읽힌다.**
   * 계정 메뉴는 «내 계정»만 다룬다.
   */
  const adminEntry = adminEntryFor(surface, isAdmin)
  const [open, setOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [activeTheme, setActiveTheme] = useState<ThemeId | undefined>(currentTheme)
  const [applying, setApplying] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  // 외부 prop이 바뀌면 동기화(서버 재검증 후)
  useEffect(() => { setActiveTheme(currentTheme) }, [currentTheme])

  const handleSelectTheme = async (id: ThemeId) => {
    if (applying) return
    const prev = activeTheme
    setApplying(true)
    // 낙관적 즉시 반영
    setActiveTheme(id)
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', id)
    try {
      const res = await fetch('/api/user/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: id }),
      })
      const json = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) throw new Error(json.error ?? '저장 실패')
      router.refresh() // SSR 재주입(영속 검증)
    } catch {
      // 롤백
      setActiveTheme(prev)
      if (typeof document !== 'undefined' && prev) document.documentElement.setAttribute('data-theme', prev)
    } finally {
      setApplying(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setThemeOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setThemeOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    clearPersistedSwrCache() // 공유 PC 데이터 잔류 차단
    router.push('/login')
    router.refresh()
  }

  const initial = name.charAt(0).toUpperCase()

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* 드롭업 메뉴 */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 0.5rem)',
            left: 0,
            right: 0,
            background: 'var(--nb-white)',
            border: 'var(--border-w) solid var(--border-color)',
            borderRadius: 'var(--radius)',
            overflow: 'visible', // 오른쪽 테마 서브메뉴 플라이아웃이 잘리지 않도록(hidden이면 clip됨)
            boxShadow: 'var(--shadow-md)',
            zIndex: 100,
          }}
        >
          {/**
            * **나가는 문이 먼저다.** 관리자 여부와 무관하게 그린다 —
            * 여기에 `isAdmin &&` 을 걸면 일반 멤버가 다시 갇힌다.
            */}
          {adminEntry && (
            <>
              <Link href={adminEntry.href} onClick={() => setOpen(false)} className={styles.row}>
                <LayoutDashboard size={14} />
                {adminEntry.label}
              </Link>
              <div className={styles.divider} />
            </>
          )}
          {settingsItems && settingsItems.length > 0 && (
            <>
              <div className={styles.groupLabel}>
                {settingsLabel ?? '설정'}
              </div>
              {settingsItems.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={styles.row}
                >
                  <SlidersHorizontal size={14} />
                  {it.label}
                </Link>
              ))}
              <div className={styles.divider} />
            </>
          )}
          <Link
            href="/change-password"
            onClick={() => setOpen(false)}
            className={styles.row}
          >
            <KeyRound size={14} />
            비밀번호 변경
          </Link>
          <Link
            href="/api-keys"
            onClick={() => setOpen(false)}
            className={styles.row}
          >
            <Code2 size={14} />
            API Keys
          </Link>
          <Link
            href="/develop"
            onClick={() => setOpen(false)}
            className={styles.row}
          >
            <BookOpen size={14} />
            개발자센터
          </Link>
          <div className={styles.divider} />
          {/*
            서비스로 들어가는 문(영업 CRM · 콘텐츠 인텔리전스 · AI 스튜디오)은 **여기 없다.**
            예전엔 콘텐츠 인텔리전스만 이 메뉴에 손으로 박혀 있었다 — 사이드바 「서비스」 묶음이
            생기기 전 유일한 길이었기 때문이다. 그 묶음이 생긴 뒤로는 같은 곳으로 가는 문이 둘이 됐고,
            셋 중 하나만 여기 있어서 **서비스마다 대접이 달라 보였다**(사용자 지적 v0.7.716).
            길은 사이드바 「서비스」 묶음과 전체 메뉴 두 곳이면 충분하다.
          */}
          {/* 패치노트 — 사이드바 버전 클릭과 동일한 모달을 window 이벤트로 연다(MobileShell이 수신). */}
          <button
            type="button"
            onClick={() => { setOpen(false); if (typeof window !== 'undefined') window.dispatchEvent(new Event('open-patchnotes')) }}
            className={styles.row}
          >
            <Sparkles size={14} />
            패치노트
          </button>
          <div className={styles.divider} />
          {/* 테마변경 — 오른쪽 서브메뉴로 개인 테마 선택 (호버/클릭 모두 열림) */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={() => setThemeOpen(true)}
            onMouseLeave={() => setThemeOpen(false)}
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={themeOpen}
              onClick={() => setThemeOpen(true)}
              className={styles.row}
              data-open={themeOpen}
            >
              <Palette size={14} />
              테마변경
              <ChevronRight size={14} className={styles.chevron} />
            </button>

            {themeOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  left: '100%', // 간격 없이 인접 — 호버 이동 시 mouseleave 누락 방지
                  bottom: 0,
                  minWidth: 210,
                  background: 'var(--nb-white)',
                  border: 'var(--border-w) solid var(--border-color)',
                  borderRadius: 'var(--radius)',
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-md)',
                  zIndex: 110,
                }}
              >
                {THEMES.map(t => {
                  const selected = activeTheme === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={applying}
                      data-theme={t.id}
                      onClick={() => handleSelectTheme(t.id)}
                      className={styles.row}
                    >
                      {/* 테마 정체성 미니 스와치 (data-theme 스코프 → 해당 테마 토큰) */}
                      <span style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                        <span style={{ width: 14, height: 14, borderRadius: 'var(--radius)', background: 'var(--brand)', border: 'var(--hairline) solid var(--border-color)' }} />
                        <span style={{ width: 14, height: 14, borderRadius: 'var(--radius)', background: 'var(--accent)', border: 'var(--hairline) solid var(--border-color)' }} />
                        <span style={{ width: 14, height: 14, borderRadius: 'var(--radius)', background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--border-color)' }} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>
                        {t.label}
                        {t.id === defaultTheme && (
                          <span style={{ marginLeft: '0.375rem', fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>(디폴트)</span>
                        )}
                      </span>
                      {selected && <Check size={14} style={{ flexShrink: 0, color: 'var(--brand)' }} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className={styles.divider} />
          <button
            onClick={handleLogout}
            className={`${styles.row} ${styles.rowDanger}`}
          >
            <LogOut size={14} />
            로그아웃
          </button>
        </div>
      )}

      {/* 프로필 버튼 */}
      <button
        ref={triggerRef}
        data-testid="sidebar-profile-trigger"
        onClick={() => setOpen(!open)}
        className={styles.trigger}
        data-open={open}
      >
        {/* 아바타 */}
        <div
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '50%',
            background: 'var(--brand)',
            border: 'var(--border-w-2) solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 'var(--fs-sm)',
            fontWeight: 700,
            /* brand 배경 위 글자색은 테마마다 다르다 — 'white' 고정이면 테마를 못 따라간다 */
            color: 'var(--brand-fg)',
          }}
        >
          {initial}
        </div>

        {/* 이름 + 이메일 */}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              fontWeight: 700,
              color: 'var(--sidebar-fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontSize: 'var(--fs-2xs)',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {email}
          </div>
        </div>

        <ChevronUp
          size={14}
          color="var(--color-text-muted)"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 200ms',
          }}
        />
      </button>
    </div>
  )
}
