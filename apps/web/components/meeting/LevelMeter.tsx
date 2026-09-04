'use client'

/**
 * 마이크 레벨 미터 — **리액트를 거치지 않고 그린다.**
 *
 * **왜 이렇게 두나.** 마이크 세기는 `requestAnimationFrame` 이 초당 60번 갱신한다.
 * 예전에는 그 값을 `useState` 로 들고 컨텍스트에 실어 보냈고, 그래서 녹음 중에는
 * 이 컨텍스트를 쓰는 화면이 **전부 초당 60번 다시 그려졌다**
 * (실측 v0.7.685: 녹음 패널 · 상주 바 · CRM 미팅 상세).
 *
 * 미터가 실제로 하는 일은 막대 하나의 `width` 를 바꾸는 것뿐이다. 그건 DOM 에
 * 직접 쓰면 되고, 리액트가 관여할 이유가 없다. 그래서 값은 구독으로만 받는다.
 *
 * 화면 낭독기에는 숨긴다 — 초당 60번 바뀌는 수치는 읽어 줄 수 없다. 대신 «소리가
 * 안 잡힌다»는 사실은 녹음 패널의 `role="status"` 안내 줄이 말한다.
 */

import { useEffect, useRef } from 'react'

interface Props {
  /** `useRecordingSession().subscribeLevel` — 참조가 안정적이어야 구독이 매 렌더 끊기지 않는다 */
  subscribe: (fn: (level: number) => void) => () => void
  /** 바깥 트랙 클래스 — 미터 모양은 쓰는 화면이 정한다 */
  className: string
  /** 채워지는 막대 클래스 */
  fillClassName: string
}

export default function LevelMeter({ subscribe, className, fillClassName }: Props) {
  const fillRef = useRef<HTMLSpanElement>(null)

  useEffect(() => subscribe((level) => {
    const el = fillRef.current
    if (!el) return
    // 범위 밖 값이 와도 막대가 트랙을 넘지 않게 접는다
    el.style.width = `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%`
  }), [subscribe])

  return (
    <span className={className} aria-hidden>
      <span ref={fillRef} className={fillClassName} style={{ width: 0 }} />
    </span>
  )
}
