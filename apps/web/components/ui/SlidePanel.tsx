'use client'

// components/ui/SlidePanel.tsx — 우측 슬라이드 패널(드로어) SSOT
//
// 골격(backdrop → 오른쪽 전체높이 카드 → 제목+X → 스크롤 본문)과 함께
// **포커스 트랩 · 본문 스크롤 잠금 · 닫을 때 포커스 복원**을 여기서 책임진다.
// 화면이 드로어를 직접 그리면 이 셋을 빠뜨려 키보드 사용자가 갇힌다.
//
// `NbModal`과의 차이: NbModal은 가운데 카드(짧은 확인·폼), SlidePanel은 오른쪽 전체높이(긴 상세·이력).

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'

interface SlidePanelProps {
  isOpen: boolean
  onClose: () => void
  /** 문자열이 기본. 제목 자리에서 바로 편집하는 화면은 노드를 넘긴다(그때는 ariaLabel 필수) */
  title?: ReactNode
  /** title이 노드일 때 스크린리더가 읽을 이름 */
  ariaLabel?: string
  /** 제목 왼쪽 아이콘 */
  icon?: ReactNode
  /** 제목 오른쪽 부가 요소(편집 버튼 등) */
  titleExtra?: ReactNode
  /** 폭을 화면이 정해야 할 때만(기본은 .slide-panel CSS) */
  width?: number
  /** 본문 스크롤 컨테이너 ref — 내용이 바뀔 때 맨 위로 되감기 위해 화면이 쥔다 */
  bodyRef?: RefObject<HTMLDivElement>
  /**
   * 본문 위에 떠 있어야 하는 조작(스크롤 점프 등). 본문 바닥에 sticky로 붙는다.
   * ⚠️ `position: fixed` 요소를 여기(또는 children)에 넣지 말 것 — 패널에 `transform`이
   * 걸려 있어 fixed가 뷰포트가 아니라 **패널 기준**이 된다(전체화면 모달이 드로어 안에 갇힌다).
   * 전체화면 모달은 `<SlidePanel>` **바깥 형제**로 렌더한다.
   */
  floating?: ReactNode
  children: React.ReactNode
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

export default function SlidePanel({
  isOpen, onClose, title, ariaLabel, icon, titleExtra, width, bodyRef, floating, children,
}: SlidePanelProps) {
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
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined) ?? '상세 정보'}
        style={width ? { width: `min(${width}px, 100vw)` } : undefined}
      >
        <div className="slide-panel-header">
          {icon}
          <h2 className="slide-panel-title">{title ?? ''}</h2>
          {titleExtra}
          <button onClick={onClose} className="slide-panel-close" aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="slide-panel-body" ref={bodyRef}>
          {children}
          {floating && <div className="slide-panel-floating">{floating}</div>}
        </div>
      </div>
    </>
  )
}
