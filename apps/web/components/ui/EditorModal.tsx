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
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: '720px',
          background: 'white', borderRadius: 'var(--radius)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 3rem)',
          overflow: 'hidden',
        }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '2px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a' }}>{title}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '0.25rem', display: 'flex', borderRadius: '0.375rem' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 에디터 영역 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
          <TiptapEditor
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            minHeight={320}
          />
        </div>

        {/* 푸터 */}
        <div style={{ padding: '0.875rem 1.25rem', borderTop: '2px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
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
