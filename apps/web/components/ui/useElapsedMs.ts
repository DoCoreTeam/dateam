'use client'

/**
 * 시작 시각부터 흐른 시간 — **한 벌만 둔다.**
 *
 * 화면마다 `useEffect` + `setInterval` 을 복붙하면 그중 하나는 반드시
 * `clearInterval` 을 빠뜨린다(그 타이머는 화면을 떠나도 계속 돈다).
 *
 * @param startedAt `Date.now()`. null 이면 아무것도 안 돈다
 */
import { useEffect, useState } from 'react'

export function useElapsedMs(startedAt: number | null): number {
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    if (startedAt === null) { setElapsedMs(0); return }
    setElapsedMs(Date.now() - startedAt)
    const t = setInterval(() => setElapsedMs(Date.now() - startedAt), 1_000)
    return () => clearInterval(t)
  }, [startedAt])
  return elapsedMs
}
