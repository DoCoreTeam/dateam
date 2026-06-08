'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LogOut, LayoutDashboard, ChevronUp } from 'lucide-react'

interface AdminUserMenuProps {
  displayName: string
}

export default function AdminUserMenu({ displayName }: AdminUserMenuProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  async function handleLogout() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
      router.refresh()
    } catch {
      // 로그아웃 실패 시 강제 리다이렉트
      router.push('/login')
    }
  }

  function handleSwitchToMember() {
    setOpen(false)
    router.push('/dashboard')
  }

  const initial = displayName.charAt(0).toUpperCase()

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open && (
        <div
          role="menu"
          aria-label="관리자 메뉴"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 0.5rem)',
            left: 0,
            right: 0,
            backgroundColor: 'var(--text)',
            border: 'var(--hairline) solid rgba(255,255,255,0.1)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
            zIndex: 100,
          }}
        >
          <MenuButton
            icon={<LayoutDashboard size={15} />}
            label="멤버 화면으로 전환"
            color="var(--border-subtle)"
            hoverBg="rgba(255,255,255,0.08)"
            onClick={handleSwitchToMember}
          />
          <div style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.06)' }} />
          <MenuButton
            icon={<LogOut size={15} />}
            label="로그아웃"
            color="var(--danger)"
            hoverBg="rgba(239,68,68,0.12)"
            onClick={handleLogout}
          />
        </div>
      )}

      <button
        ref={triggerRef}
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: 'var(--space-2)',
          background: open ? 'rgba(255,255,255,0.07)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--radius)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background-color 120ms',
        }}
      >
        <div style={{
          width: '1.875rem', height: '1.875rem', borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--danger), var(--danger))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'white',
        }}>
          {initial}
        </div>
        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--border-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </div>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>관리자</div>
        </div>
        <ChevronUp
          size={14}
          style={{
            color: 'var(--text-muted)',
            flexShrink: 0,
            transition: 'transform 150ms',
            transform: open ? 'rotate(0deg)' : 'rotate(180deg)',
          }}
        />
      </button>
    </div>
  )
}

function MenuButton({
  icon, label, color, hoverBg, onClick,
}: {
  icon: React.ReactNode
  label: string
  color: string
  hoverBg: string
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.625rem 0.875rem',
        background: hovered ? hoverBg : 'transparent',
        border: 'none',
        color,
        fontSize: 'var(--fs-sm)',
        fontWeight: 500,
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: '44px',
        transition: 'background-color 120ms',
      }}
    >
      <span style={{ flexShrink: 0, opacity: 0.8, display: 'flex', alignItems: 'center' }}>
        {icon}
      </span>
      {label}
    </button>
  )
}
