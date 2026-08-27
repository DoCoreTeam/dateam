'use client'

/**
 * 캘린더 화면 — 보드 하나를 그대로 편다.
 *
 * 예전엔 이 파일이 715줄짜리 구현 그 자체였다. 홈에 캘린더를 메인으로 두려면
 * 같은 달을 두 번 그리게 되므로(사용자 지시 2026-08-27) 구현을 `CalendarBoard` 로 옮기고
 * 여기는 **주소와 셸만** 맡는다. 둘이 같은 부품을 쓰니 한쪽만 고쳐지는 일이 없다.
 *
 * `Suspense` 는 필수다 — 보드가 `useSearchParams()` 로 상태를 읽고,
 * 경계가 없으면 정적 프리렌더에서 `next build` 가 이 페이지에서 통째로 실패한다
 * (전례: v0.7.455 /develop — dev 서버는 멀쩡했고 이틀간 안 드러났다).
 */

import { Suspense, useEffect } from 'react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import CalendarBoard from './CalendarBoard'

export default function CalendarPage() {
  // 캘린더 방문 시 배지 소멸을 위한 cookie 설정
  useEffect(() => {
    const d = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
    document.cookie = `calendar_seen_date=${d}; path=/; max-age=172800; SameSite=Lax`
  }, [])

  return (
    <Suspense fallback={<AXDotLoader />}>
      <CalendarBoard basePath="/calendar" />
    </Suspense>
  )
}
