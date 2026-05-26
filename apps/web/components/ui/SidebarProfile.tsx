'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { KeyRound, LogOut, ChevronUp, LayoutDashboard } from 'lucide-react'

interface SidebarProfileProps {
  name: string
  email: string
  isAdmin?: boolean
}

export default function SidebarProfile({ name, email, isAdmin = false }: SidebarProfileProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
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
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '0.75rem',
            overflow: 'hidden',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
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
                  padding: '0.75rem 1rem',
                  fontSize: '0.8125rem',
                  color: '#a5b4fc',
                  textDecoration: 'none',
                  transition: 'background 120ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <LayoutDashboard size={14} />
                관리자 패널
              </Link>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0 0.75rem' }} />
            </>
          )}
          <Link
            href="/change-password"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: '0.75rem 1rem',
              fontSize: '0.8125rem',
              color: '#cbd5e1',
              textDecoration: 'none',
              transition: 'background 120ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <KeyRound size={14} />
            비밀번호 변경
          </Link>
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0 0.75rem' }} />
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '0.8125rem',
              color: '#f87171',
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
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          width: '100%',
          padding: '0.5rem 0.625rem',
          background: open ? 'rgba(255,255,255,0.07)' : 'transparent',
          border: 'none',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          transition: 'background 120ms',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        {/* 아바타 */}
        <div
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: '0.8125rem',
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
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: '#e2e8f0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontSize: '0.6875rem',
              color: '#64748b',
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
          color="#64748b"
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
