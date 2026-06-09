'use client'

import type { ReactNode, CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'

// 공용 모달 (SSOT) — backdrop/카드/ESC/X/제목 표준(CLAUDE.md §2-2).
// 화면마다 직접 만들던 모달을 통일: backdrop=--modal-backdrop 토큰, 카드=--color-surface, 광원형 그림자.

interface NbModalProps {
  /** 모달 제목 (tape-title) */
  title?: ReactNode
  /** 헤더 우측 영역(제목 옆 부가) */
  headerExtra?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** 카드 최대 폭(px) */
  maxWidth?: number
  ariaLabel?: string
  /** ESC/백드롭 클릭 닫기 비활성 */
  disableClose?: boolean
}

export default function NbModal({
  title, headerExtra, onClose, children, footer, maxWidth = 560, ariaLabel, disableClose = false,
}: NbModalProps) {
  useEscClose(onClose, !disableClose)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : '대화상자')}
      onClick={disableClose ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'var(--modal-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth, background: 'var(--color-surface)',
          borderRadius: 'var(--radius)', padding: 'var(--space-6)',
          boxShadow: 'var(--shadow-modal)',
          maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
        }}
      >
        {(title || !disableClose || headerExtra) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {title && <h3 className="tape-title" style={{ margin: 0 }}>{title}</h3>}
              {headerExtra}
            </div>
            {!disableClose && (
              <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', flexShrink: 0 }}>
                <X size={18} />
              </button>
            )}
          </div>
        )}
        {children}
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>{footer}</div>}
      </div>
    </div>
  )
}

export type { CSSProperties as NbModalStyle }
