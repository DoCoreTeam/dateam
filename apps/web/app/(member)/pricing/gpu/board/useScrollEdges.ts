'use client'

// 가로로 밀리는 표 몸통 — 머리줄을 같이 밀고, 왼쪽 오른쪽에 더 있는지 알려 준다 (가장자리 그림자)
// 머리줄은 페이지 세로 스크롤에 붙어야 해서 몸통과 다른 상자에 두고 scrollLeft 만 맞춘다

import { useEffect, useRef, useState } from 'react'

/** 끝에서 이만큼 안이면 끝에 닿은 것으로 본다 (소수점 픽셀) */
const EDGE_SLACK_PX = 1

export interface ScrollEdges {
  moreLeft: boolean
  moreRight: boolean
}

export function useScrollEdges() {
  const headRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<ScrollEdges>({ moreLeft: false, moreRight: false })

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const update = () => {
      if (headRef.current) headRef.current.scrollLeft = body.scrollLeft
      const moreLeft = body.scrollLeft > EDGE_SLACK_PX
      const moreRight = body.scrollLeft + body.clientWidth < body.scrollWidth - EDGE_SLACK_PX
      setEdges((prev) => (prev.moreLeft === moreLeft && prev.moreRight === moreRight ? prev : { moreLeft, moreRight }))
    }
    update()
    body.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(body)
    if (body.firstElementChild) ro.observe(body.firstElementChild)
    return () => {
      body.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  return { headRef, bodyRef, edges }
}
