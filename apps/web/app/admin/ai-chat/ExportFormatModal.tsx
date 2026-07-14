'use client'
import { useState } from 'react'
import { X, FileText, FileType, FileDown, File } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'

export type ExportFormat = 'md' | 'txt' | 'pdf' | 'docx'

interface FormatOption {
  id: ExportFormat
  label: string
  desc: string
  icon: typeof FileText
}

const OPTIONS: FormatOption[] = [
  { id: 'md', label: 'Markdown (.md)', desc: '코드펜스·서식 보존, 개발자용', icon: FileText },
  { id: 'txt', label: '텍스트 (.txt)', desc: '서식 없는 순수 텍스트', icon: FileType },
  { id: 'pdf', label: 'PDF (.pdf)', desc: '인쇄·공유용 문서', icon: FileDown },
  { id: 'docx', label: 'Word (.docx)', desc: '편집 가능한 문서', icon: File },
]

interface Props {
  onSelect: (format: ExportFormat) => void
  onClose: () => void
  busy: ExportFormat | null
  error: string | null
}

// 내보내기 포맷 선택 모달(④) — 표준: useEscClose·tape-title·boxShadow(--shadow-modal)·backdrop(--modal-backdrop).
export default function ExportFormatModal({ onSelect, onClose, busy, error }: Props) {
  useEscClose(onClose)
  const [hovered, setHovered] = useState<ExportFormat | null>(null)

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        background: 'var(--modal-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 420,
          background: 'var(--color-surface)', borderRadius: 'var(--radius)',
          padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)',
          maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>내보내기 포맷 선택</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}
          >
            <X size={18} />
          </button>
        </div>

        <div role="listbox" aria-label="내보내기 포맷" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {OPTIONS.map((opt) => {
            const Icon = opt.icon
            const isBusy = busy === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={false}
                disabled={busy !== null}
                onClick={() => onSelect(opt.id)}
                onMouseEnter={() => setHovered(opt.id)}
                onMouseLeave={() => setHovered((h) => (h === opt.id ? null : h))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  width: '100%', textAlign: 'left',
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius)',
                  border: `var(--border-w) solid ${hovered === opt.id ? 'var(--brand)' : 'var(--border-color)'}`,
                  background: hovered === opt.id ? 'var(--surface-bg)' : 'transparent',
                  cursor: busy !== null ? 'wait' : 'pointer',
                  transition: 'border-color 0.15s ease, background 0.15s ease',
                  opacity: busy !== null && !isBusy ? 0.5 : 1,
                }}
              >
                <Icon size={18} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>
                    {isBusy ? '생성 중…' : opt.label}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
                    {opt.desc}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)',
              background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)',
              borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
