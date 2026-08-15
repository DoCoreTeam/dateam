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

import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  const ref = useRef<HTMLSpanElement>(null)
  useEscClose(() => setOpen(false), open)

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
            <span className="row-actions-menu" aria-label={subject ? `${subject} 작업` : '작업'}>
              {rest.map((item, i) => <span key={i} className="row-actions-item">{item}</span>)}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
