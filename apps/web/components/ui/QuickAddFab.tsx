'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Plus, X } from 'lucide-react'
import { fabActionsForPath } from '@/lib/fab-actions'

// 우하단 빠른 추가 FAB — 하이브리드 speed-dial.
//   닫힘: + 버튼. 열림: 현재 페이지 우선(강조) + 전역 빠른 추가 + 가격·견적 입력.
//   미지정 페이지도 동일 목록(통합입력 기본 강조). a11y: aria-expanded·ESC·바깥 클릭 닫힘.
export default function QuickAddFab() {
  const pathname = usePathname() || ''
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { actions, primaryKey } = fabActionsForPath(pathname)

  // 페이지 이동 시 닫힘
  useEffect(() => { setOpen(false) }, [pathname])

  // admin 콘솔 등에선 노출 안 함(회원 빠른추가 전용)
  if (pathname.startsWith('/admin')) return null

  // ESC · 바깥 클릭 닫힘
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open])

  return (
    <div ref={ref} className="quickadd-fab-wrap mobile-only-flex">
      {open && (
        <div className="quickadd-menu" role="group" aria-label="빠른 추가">
          {actions.map((a) => {
            const Icon = a.icon
            const emphasis = a.key === primaryKey
            return (
              <Link
                key={a.key}
                href={a.href}
                className={emphasis ? 'quickadd-item quickadd-item--primary' : 'quickadd-item'}
                onClick={() => setOpen(false)}
              >
                <span className="quickadd-item-label">{a.label}</span>
                <span className="quickadd-item-icon"><Icon size={18} /></span>
              </Link>
            )
          })}
        </div>
      )}
      <button
        type="button"
        className="intake-fab"
        aria-label={open ? '빠른 추가 닫기' : '빠른 추가'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        style={{ transform: open ? 'rotate(45deg)' : 'none' }}
      >
        {open ? <X size={22} strokeWidth={2.5} /> : <Plus size={22} strokeWidth={2.5} />}
      </button>
    </div>
  )
}
