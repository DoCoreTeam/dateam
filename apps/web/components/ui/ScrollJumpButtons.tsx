'use client'

// 전역 스크롤 점프 — 긴 페이지에서 맨 위/맨 아래로 한 번에 이동(기본 UX). 스크롤 컨테이너(main.page-inner) 대상.
// 스크롤 여지가 충분할 때만 노출하고, 이미 끝(위/아래)이면 해당 방향 버튼은 숨긴다. FAB 위에 배치.

import { useEffect, useState, type RefObject } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'

const THRESHOLD = 240 // 이만큼 스크롤 가능해야 버튼 노출(짧은 페이지엔 안 뜸)
const EDGE = 48 // 위/아래 끝 판정 여유

export default function ScrollJumpButtons({ targetRef }: { targetRef: RefObject<HTMLElement> }) {
  const [visible, setVisible] = useState(false)
  const [atTop, setAtTop] = useState(true)
  const [atBottom, setAtBottom] = useState(false)

  useEffect(() => {
    const el = targetRef.current
    if (!el) return
    const update = (): void => {
      setVisible(el.scrollHeight - el.clientHeight > THRESHOLD)
      setAtTop(el.scrollTop < EDGE)
      setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - EDGE)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [targetRef])

  if (!visible) return null

  const jump = (top: number): void => targetRef.current?.scrollTo({ top, behavior: 'smooth' })
  const btnStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: 'var(--hairline) solid var(--border-color)',
    background: 'var(--color-surface)',
    color: 'var(--text-muted)',
    boxShadow: 'var(--shadow-md)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 'var(--space-4)',
        bottom: 92, // FAB(하단) 위로
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        zIndex: 40,
      }}
    >
      {!atTop && (
        <button type="button" onClick={() => jump(0)} style={btnStyle} aria-label="맨 위로" title="맨 위로">
          <ArrowUp size={18} />
        </button>
      )}
      {!atBottom && (
        <button
          type="button"
          onClick={() => jump(targetRef.current?.scrollHeight ?? 0)}
          style={btnStyle}
          aria-label="맨 아래로"
          title="맨 아래로"
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  )
}
