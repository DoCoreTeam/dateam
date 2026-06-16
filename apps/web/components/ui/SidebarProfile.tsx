'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { KeyRound, LogOut, ChevronUp, LayoutDashboard, Code2, BookOpen, Palette, Check, ChevronRight } from 'lucide-react'
import { THEMES, type ThemeId } from '@/lib/themes'
import { clearPersistedSwrCache } from '@/lib/swr-persist'

interface SidebarProfileProps {
  name: string
  email: string
  isAdmin?: boolean
  currentTheme?: ThemeId
  defaultTheme?: ThemeId
}

export default function SidebarProfile({ name, email, isAdmin = false, currentTheme, defaultTheme }: SidebarProfileProps) {
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
          {isAdmin && (
            <>
              <Link
                href="/admin/users"
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: 'var(--space-3) var(--space-4)',
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--text)',
                  textDecoration: 'none',
                  transition: 'background 120ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <LayoutDashboard size={14} />
                관리자 패널
              </Link>
              <div style={{ height: '1px', background: 'rgba(0,0,0,0.1)', margin: '0 0.75rem' }} />
            </>
          )}
          <Link
            href="/change-password"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--text)',
              textDecoration: 'none',
              transition: 'background 120ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <KeyRound size={14} />
            비밀번호 변경
          </Link>
          <Link
            href="/api-keys"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--text)',
              textDecoration: 'none',
              transition: 'background 120ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Code2 size={14} />
            API Keys
          </Link>
          <Link
            href="/develop"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--text)',
              textDecoration: 'none',
              transition: 'background 120ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <BookOpen size={14} />
            개발자센터
          </Link>
          <div style={{ height: '1px', background: 'rgba(0,0,0,0.1)', margin: '0 0.75rem' }} />
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                width: '100%',
                padding: 'var(--space-3) var(--space-4)',
                fontSize: 'var(--fs-sm)',
                color: 'var(--text)',
                background: themeOpen ? 'rgba(0,0,0,0.05)' : 'none',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 120ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
              onMouseLeave={e => { if (!themeOpen) e.currentTarget.style.background = 'transparent' }}
            >
              <Palette size={14} />
              테마변경
              <ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }} />
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
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        width: '100%',
                        padding: 'var(--space-3) var(--space-4)',
                        background: 'none',
                        border: 'none',
                        cursor: applying ? 'wait' : 'pointer',
                        textAlign: 'left',
                        transition: 'background 120ms',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
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
          <div style={{ height: '1px', background: 'rgba(0,0,0,0.1)', margin: '0 0.75rem' }} />
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              width: '100%',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--danger)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 120ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          width: '100%',
          padding: '0.5rem 0.625rem',
          background: open ? 'rgba(0,0,0,0.06)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--radius)',
          cursor: 'pointer',
          transition: 'background 120ms',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.05)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
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
            color: 'white',
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
