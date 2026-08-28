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
  /**
   * 높이를 **고정**한다(뷰포트 비율).
   *
   * **왜 필요한가**: 탭이나 단계로 내용이 바뀌는 모달은 내용 길이에 따라 위아래로 출렁인다 —
   * 방금 누른 버튼이 다른 자리로 옮겨 가고, 눈이 매번 다시 찾는다
   * (사용자 지적 2026-08-28: 「모달이 위아래로 출렁거리는게 싫어서 전체 항목을 기준으로
   *  크기가 일정해서 안에 내용만 변경되는 것처럼 보이길 원해」).
   *
   * 켜면 머리글과 바닥(버튼 줄)은 **붙박이**가 되고 본문만 스크롤된다 —
   * 확정 버튼이 늘 같은 자리에 있다.
   */
  fixedHeight?: string
}

export default function NbModal({
  title, headerExtra, onClose, children, footer, maxWidth = 560, ariaLabel, disableClose = false,
  fixedHeight,
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
          boxSizing: 'border-box',
          /*
            고정 높이일 때는 카드가 세로 flex 가 되고 **본문만** 스크롤한다.
            카드 전체를 스크롤하면 바닥의 확정 버튼이 화면 밖으로 밀려나
            «저장이 어디 있지»가 된다.
          */
          ...(fixedHeight
            ? { height: fixedHeight, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
            : { maxHeight: '90vh', overflowY: 'auto' }),
        }}
      >
        {(title || !disableClose || headerExtra) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexShrink: 0 }}>
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
        {fixedHeight
          ? <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>{children}</div>
          : children}
        {footer && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)',
            marginTop: 'var(--space-4)', flexShrink: 0,
          }}>{footer}</div>
        )}
      </div>
    </div>
  )
}

export type { CSSProperties as NbModalStyle }
