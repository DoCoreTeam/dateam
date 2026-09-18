'use client'

// components/ui/list/RowActions.tsx — 표 행의 작업 묶음
//
// 왜 부품이 필요한가: 행 작업을 화면이 그냥 `<div style={{flexWrap:'wrap'}}>`로 늘어놓으면,
// 작업이 셋을 넘는 순간 **좁은 칸에서 접혀 그 행만 세로로 커진다.**
//   실측 /admin/members: 관리 칸 135px에 버튼 5개 → 5줄, 행 높이 216px(다른 정보는 50px)
//   실측 /admin/partner-tiers: 관리 칸 170px에 버튼 2개 → 2줄, 행 높이 119px
// 목록의 리듬이 깨지고, 32명이면 화면이 그만큼 길어진다.
//
// 그래서 **접힐 수 없는 구조**로 만든다 — 앞의 몇 개만 한 줄에 두고 나머지는 더보기 안으로 접는다.
// 칸 폭이 얼마든 한 줄이 보장되므로, 화면마다 폭을 재서 맞출 필요가 없다.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'

interface Props {
  /**
   * 작업 버튼들. 각자 자기 확인 절차(인라인 confirm·모달)를 가진 기존 컴포넌트를 그대로 넣는다
   * — 선언형 `actions[]`로 바꾸려면 그 컴포넌트들을 전부 다시 써야 해서, 있는 것을 담는 쪽을 택했다.
   */
  children: ReactNode
  /** 한 줄에 남길 개수(기본 1 = 주요 작업 하나). 나머지는 더보기 안으로 간다. */
  inline?: number
  /** 더보기 버튼의 접근성 이름에 붙는 대상 이름 — "김도현 작업 더보기" */
  subject?: string
}

export default function RowActions({ children, inline = 1, subject }: Props) {
  const [open, setOpen] = useState(false)
  /**
   * 위로 열지 아래로 열지. 아래가 기본이고, **아래에 자리가 없을 때만** 위로 뒤집는다.
   *
   * 왜 (사용자 지적 2026-09-19): 목록 맨 아래 행에서 더보기를 누르면 메뉴가 화면 밖으로
   * 잘려 나갔다. 삭제 확인까지 펼치면 확인 단추가 화면 밑으로 사라져서, 누를 수가 없었다.
   * 목록의 마지막 행은 사람이 제일 자주 만지는 자리다 — 새로 온 사람이 거기 있기 때문이다.
   */
  const [dropUp, setDropUp] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLSpanElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  useEscClose(() => setOpen(false), open)

  const place = useCallback(() => {
    const menu = menuRef.current
    const toggle = toggleRef.current
    if (!menu || !toggle) return
    const MARGIN = 8
    const height = menu.offsetHeight
    const t = toggle.getBoundingClientRect()
    const roomBelow = window.innerHeight - t.bottom - MARGIN
    const roomAbove = t.top - MARGIN
    // 둘 다 모자라면 아래로 둔다 — 아래는 스크롤이라도 되지만 위로 넘긴 것은 닿을 길이 없다
    setDropUp(height > roomBelow && roomAbove >= height)
  }, [])

  // 그린 직후에 잰다. 메뉴 안에서 삭제 확인이 펼쳐져 키가 달라지면 그때 다시 잰다 —
  // 열 때 한 번만 재면, 길어진 메뉴가 도로 화면 밖으로 나간다(그 상태가 실제 지적받은 화면이다).
  useLayoutEffect(() => {
    if (!open) { setDropUp(false); return }
    place()
    const menu = menuRef.current
    if (!menu || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(menu)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  // 바깥을 누르면 닫는다. 열려 있을 때만 듣는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const items = Array.isArray(children) ? children.flat().filter(Boolean) : [children]
  const front = items.slice(0, inline)
  const rest = items.slice(inline)

  return (
    // 행 전체가 눌리는 목록이면, 작업 버튼 클릭이 행 클릭(상세 열기)까지 발화한다 — 여기서 끊는다.
    <span className="row-actions" ref={ref} onClick={(e) => e.stopPropagation()}>
      {front}
      {rest.length > 0 && (
        <span className="row-actions-more">
          <button
            ref={toggleRef}
            type="button"
            className="btn-ghost row-actions-toggle"
            aria-haspopup="true"
            aria-expanded={open}
            aria-label={subject ? `${subject} 작업 더보기` : '작업 더보기'}
            title="작업 더보기"
            onClick={() => setOpen((v) => !v)}
          >
            <MoreHorizontal size={16} />
          </button>
          {open && (
            // `role="menu"/"menuitem"`을 붙이지 않는다 — 담기는 것이 임의의 버튼(인라인 확인·모달 트리거)이라
            // 메뉴 항목 시맨틱과 맞지 않는다. 잘못된 role은 없느니만 못하다.
            // 누른다고 닫지도 않는다: `DeleteTierButton`처럼 **누른 자리에서 확인을 띄우는** 버튼이 있어서,
            // 닫아 버리면 그 확인이 화면에서 사라진다. 닫기는 바깥 클릭·ESC로만 한다.
            <span
              ref={menuRef}
              className={`row-actions-menu${dropUp ? ' is-up' : ''}`}
              aria-label={subject ? `${subject} 작업` : '작업'}
            >
              {rest.map((item, i) => <span key={i} className="row-actions-item">{item}</span>)}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
