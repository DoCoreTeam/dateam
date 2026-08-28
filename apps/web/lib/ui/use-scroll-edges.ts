/**
 * 가로로 넘겨 보는 판의 «더 있다» 신호 (SSOT)
 *
 * **왜 필요한가**: 맥은 스크롤바를 숨긴다. 그래서 오른쪽에 칸이 더 있어도
 * **잘린 것처럼만 보이고**, 사용자는 넘길 수 있다는 것을 모른다
 * (사용자 지적 2026-08-28: 「좌우 스크롤이 없는데 우측에 더 있다는걸 파악 못하겠는데?
 *  좌우 이동 버튼도 배치해야지?」).
 *
 * 가로 스크롤이 있는 곳은 보드 말고도 생긴다 — 그때마다 다시 만들지 않게 훅으로 둔다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ScrollEdges {
  /**
   * 스크롤 컨테이너에 붙인다.
   *
   * React 18 의 `ref` prop 은 `RefObject<T>`(널 아님)를 받는데 `useRef<T>(null)` 은
   * `RefObject<T | null>` 이다 — 타입만 맞추고 값은 같다.
   */
  ref: React.MutableRefObject<HTMLDivElement | null>
  /** 왼쪽에 더 있나 */
  canLeft: boolean
  /** 오른쪽에 더 있나 */
  canRight: boolean
  /** 한 화면씩 넘긴다 */
  scrollBy: (dir: -1 | 1) => void
}

export function useScrollEdges(): ScrollEdges {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    // 1px 여유 — 브라우저가 소수점을 남겨 «끝까지 갔는데 버튼이 남는» 일을 막는다
    setCanLeft(el.scrollLeft > 1)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    /*
      **내용이 바뀌어도 다시 잰다.** 딜이 로드되면 칸 폭이 달라지는데
      스크롤 이벤트만 듣고 있으면 처음 상태로 굳는다.
    */
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [measure])

  const scrollBy = useCallback((dir: -1 | 1) => {
    const el = ref.current
    if (!el) return
    // 한 화면의 80% — 다 넘기면 방금 본 칸이 사라져 맥락을 잃는다
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }, [])

  return { ref, canLeft, canRight, scrollBy }
}
