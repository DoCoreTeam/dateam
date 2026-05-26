'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface SlidePanelProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

export default function SlidePanel({ isOpen, onClose, title, children }: SlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'

    // 첫 번째 포커서블 요소에 포커스 이동
    const id = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      el?.focus()
    }, 50)

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return

      const focusables = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (!focusables.length) return
      const first = focusables[0]
      const last  = focusables[focusables.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus() }
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => {
      clearTimeout(id)
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
      previousFocusRef.current?.focus()
    }
  }, [isOpen, onClose])

  return (
    <>
      {isOpen && (
        <div className="slide-panel-backdrop" onClick={onClose} aria-hidden="true" />
      )}
      <div
        ref={panelRef}
        className={`slide-panel${isOpen ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title || '상세 정보'}
      >
        <div className="slide-panel-header">
          <h2 className="slide-panel-title">{title ?? ''}</h2>
          <button onClick={onClose} className="slide-panel-close" aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="slide-panel-body">
          {children}
        </div>
      </div>
    </>
  )
}
