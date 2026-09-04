'use client'

/**
 * 우클릭 메뉴 — **공용 부품(SSOT).**
 *
 * 사용자 지시(2026-09-02): *"캘린더 칸에서는 우측 버튼이 우리 위주로 …
 * 휴대폰 태블릿은 길게 누르는게 있어"*.
 *
 * **왜 부품인가**: 착수 시점 실측으로 저장소 전체에 `onContextMenu` 가 **0건**이었다.
 * 즉 지금 만드는 것이 첫 구현이고, 화면에서 바로 자작하면 두 번째 사용처가 생기는
 * 순간 복붙본이 된다(§0 시스템 참조 순서). 그래서 화면은 **항목 데이터만** 넘긴다.
 *
 * **범위를 좁게 잡는 것이 규칙이다.** 브라우저 메뉴를 막는 곳은 이 훅을 붙인 요소뿐이다.
 * Firefox 는 Shift+우클릭으로 페이지 메뉴를 건너뛸 수 있지만 **Chrome 에는 그 우회가 없다** —
 * 전역으로 막으면 그 화면에서 「새로고침·번역·이미지 저장」을 영영 못 쓴다.
 *
 * **터치에는 우클릭이 없다.** 그래서 길게 누르기(500ms)를 같은 훅이 함께 처리한다.
 * Android Chrome 은 길게 누르면 `contextmenu` 가 발화하지만 **iOS Safari 는 발화하지 않고**
 * 네이티브 말풍선을 띄운다 — 그래서 포인터 타이머가 따로 필요하고, CSS 로
 * `-webkit-touch-callout: none` 을 걸어 말풍선을 막는다(모듈 CSS 가 속성으로 자동 적용).
 */

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './context-menu.module.css'

/** 길게 누름으로 인정하는 시간 — 짧으면 스크롤 시작을 메뉴로 오인한다 */
const LONG_PRESS_MS = 500
/** 이만큼 움직이면 스크롤 의도로 본다(px) */
const MOVE_TOLERANCE = 10
/** 화면 가장자리에서 띄울 때 남기는 여백(px) */
const EDGE_GAP = 8

export interface ContextMenuItem {
  key: string
  label: string
  /** 왼쪽 아이콘 */
  icon?: ReactNode
  /** 오른쪽 배지 — 어느 시스템의 일인지(업무·CRM·콘텐츠) */
  surfaceLabel?: string
  /** 삭제처럼 되돌릴 수 없는 것 */
  danger?: boolean
  disabled?: boolean
  /** 이 항목 **위에** 구분선을 긋는다 */
  separatorBefore?: boolean
  onSelect: () => void
}

export interface ContextMenuAnchor {
  x: number
  y: number
}

interface Props {
  /** 뜰 자리 — 커서(또는 손가락) 좌표. 뷰포트 기준(clientX/clientY) */
  anchor: ContextMenuAnchor
  /** 맨 위 제목 줄 — 무엇에 대한 메뉴인지 */
  title?: string
  items: ContextMenuItem[]
  onClose: () => void
  ariaLabel?: string
}

export default function ContextMenu({ anchor, title, items, onClose, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y })

  useEffect(() => { setMounted(true) }, [])

  /**
   * **화면 밖으로 나가면 뒤집는다.** 커서가 오른쪽 끝이면 메뉴는 왼쪽으로,
   * 아래 끝이면 위로 편다. 안 하면 마지막 줄의 항목이 잘려 아예 못 누른다.
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = anchor.x
    let top = anchor.y
    if (left + width > vw - EDGE_GAP) left = Math.max(EDGE_GAP, anchor.x - width)
    if (top + height > vh - EDGE_GAP) top = Math.max(EDGE_GAP, anchor.y - height)
    // 뒤집어도 안 들어가는 경우(메뉴가 화면보다 큰 경우) — 가장자리에 붙인다
    if (left < EDGE_GAP) left = EDGE_GAP
    if (top < EDGE_GAP) top = EDGE_GAP
    setPos({ left, top })
  }, [anchor.x, anchor.y, mounted, items.length])

  /** 열리면 첫 항목에 초점 — 키보드 사용자가 곧바로 ↑↓ 로 고를 수 있어야 한다 */
  useEffect(() => {
    if (!mounted) return
    const first = ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
    first?.focus()
  }, [mounted])

  /** 바깥 클릭·스크롤·리사이즈·ESC 로 닫는다 — 메뉴가 화면에 남아 떠도는 일이 없게 */
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onScroll = () => onClose()
    // capture 로 받는다 — 아래 요소가 stopPropagation 해도 메뉴는 닫혀야 한다
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('blur', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('blur', onScroll)
    }
  }, [onClose])

  /** 키보드 — ↑↓ 이동 · Home/End · Enter/Space 실행 · ESC/Tab 닫기(메뉴 표준) */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const root = ref.current
    if (!root) return
    const list = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
    )
    if (list.length === 0) return
    const idx = list.indexOf(document.activeElement as HTMLButtonElement)

    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'Tab') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(idx + 1 + list.length) % list.length].focus(); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(idx - 1 + list.length) % list.length].focus(); return }
    if (e.key === 'Home') { e.preventDefault(); list[0].focus(); return }
    if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus() }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      aria-label={ariaLabel ?? title ?? '메뉴'}
      onKeyDown={onKeyDown}
      /* 메뉴 위에서 또 우클릭하면 브라우저 메뉴가 겹친다 — 여기서도 막는다 */
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && <div className={styles.head}>{title}</div>}
      {items.map((it) => (
        <div key={it.key}>
          {it.separatorBefore && <div className={styles.sep} role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            data-danger={it.danger ? 'true' : undefined}
            disabled={it.disabled}
            onClick={() => { onClose(); it.onSelect() }}
          >
            {it.icon && <span className={styles.icon} aria-hidden="true">{it.icon}</span>}
            <span className={styles.label}>{it.label}</span>
            {it.surfaceLabel && <span className={styles.surface}>{it.surfaceLabel}</span>}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

export interface ContextMenuState {
  anchor: ContextMenuAnchor
  /** 무엇을 눌렀는지 — 화면이 이 값으로 항목을 만든다 */
  targetKey: string
}

/**
 * 우클릭·길게누르기를 받아 여는 손잡이.
 *
 * 화면은 `triggerProps(targetKey)` 를 **요소에 펼쳐 넣기만** 한다 —
 * `onContextMenu` 를 직접 쓰지 않는다(가드가 차단한다).
 */
export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPt = useRef<{ x: number; y: number } | null>(null)
  /** 길게 눌러 열었으면 뒤따르는 click 을 삼킨다 — 안 그러면 메뉴와 상세가 같이 열린다 */
  const swallowClick = useRef(false)

  const close = useCallback(() => setState(null), [])

  const cancelTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    startPt.current = null
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const openAt = useCallback((x: number, y: number, targetKey: string) => {
    setState({ anchor: { x, y }, targetKey })
  }, [])

  const triggerProps = useCallback((targetKey: string) => ({
    'data-ctx-target': 'true' as const,
    onContextMenu: (e: React.MouseEvent) => {
      // 이 요소 위에서만 브라우저 메뉴를 막는다 — 바깥은 그대로 둔다
      e.preventDefault()
      e.stopPropagation()
      cancelTimer()
      openAt(e.clientX, e.clientY, targetKey)
    },
    onPointerDown: (e: React.PointerEvent) => {
      // 마우스는 우클릭이 있으니 타이머가 필요 없다(왼쪽 버튼을 눌러 둔 것은 드래그다)
      if (e.pointerType === 'mouse') return
      cancelTimer()
      const { clientX: x, clientY: y } = e
      startPt.current = { x, y }
      timer.current = setTimeout(() => {
        timer.current = null
        swallowClick.current = true
        openAt(x, y, targetKey)
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = startPt.current
      if (!s || !timer.current) return
      if (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE) {
        cancelTimer() // 스크롤 중이다 — 메뉴를 열지 않는다
      }
    },
    onPointerUp: cancelTimer,
    onPointerCancel: cancelTimer,
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }), [cancelTimer, openAt])

  return { state, close, triggerProps, openAt }
}
