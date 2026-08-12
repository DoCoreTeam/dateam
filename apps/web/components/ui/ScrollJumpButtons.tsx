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
    // 좌표를 스스로 정하지 않는다 — Dock(components/ui/shell/Dock.tsx)의 utility 슬롯이 위치를 준다.
    // 예전에는 FAB를 피하려고 여백을 손으로 계산해 넣었고, FAB이 하나 늘 때마다 어긋났다.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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
