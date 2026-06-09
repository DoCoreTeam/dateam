'use client'

import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { X } from 'lucide-react'

const TiptapEditor = dynamic(() => import('./TiptapEditor'), { ssr: false })

interface EditorModalProps {
  title: string
  value: string
  placeholder?: string
  onClose: () => void
  onChange: (html: string) => void
}

export default function EditorModal({ title, value, placeholder, onClose, onChange }: EditorModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'var(--modal-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: '720px',
          background: 'white', borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-modal)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 3rem)',
          overflow: 'hidden',
        }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--border-w-2) solid var(--border-color)' }}>
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>{title}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 'var(--space-1)', display: 'flex', borderRadius: 'var(--radius)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 에디터 영역 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4) var(--space-5)' }}>
          <TiptapEditor
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            minHeight={320}
          />
        </div>

        {/* 푸터 */}
        <div style={{ padding: '0.875rem 1.25rem', borderTop: 'var(--border-w-2) solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            className="btn-primary"
            style={{ minWidth: '80px' }}
          >
            완료
          </button>
        </div>
      </div>
    </div>
  )
}
