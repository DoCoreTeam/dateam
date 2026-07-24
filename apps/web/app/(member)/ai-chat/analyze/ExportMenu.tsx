'use client'

// 목록 심층분석 — 공용 다운로드 드롭다운(SSOT). "다운로드" 버튼 1개 → 포맷(md/txt/docx/pdf) 선택.
// 문서 상세 드로어·종합 인사이트 패널이 동일 컴포넌트를 재사용한다(4버튼 나열 금지 — 툴바 정렬 깨짐 방지).

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'

export type ExportFormat = 'md' | 'txt' | 'docx' | 'pdf'

const FORMATS: { fmt: ExportFormat; label: string }[] = [
  { fmt: 'md', label: 'Markdown (.md)' },
  { fmt: 'txt', label: '텍스트 (.txt)' },
  { fmt: 'docx', label: 'Word (.docx)' },
  { fmt: 'pdf', label: 'PDF (.pdf)' },
]

interface Props {
  onExport: (format: ExportFormat) => void
  disabled?: boolean
}

export default function ExportMenu({ onExport, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <NbButton
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Download size={14} /> 다운로드 <ChevronDown size={14} />
      </NbButton>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--space-1))',
            left: 0,
            zIndex: 1100,
            minWidth: 180,
            background: 'var(--color-surface)',
            border: 'var(--hairline) solid var(--border-color)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-md)',
            padding: 'var(--space-1)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {FORMATS.map(({ fmt, label }) => (
            <button
              key={fmt}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onExport(fmt)
              }}
              style={{
                textAlign: 'left',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text)',
                fontSize: 'var(--fs-sm)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius)',
                minHeight: 40,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-bg)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
