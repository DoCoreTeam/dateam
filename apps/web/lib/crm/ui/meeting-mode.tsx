'use client'

/**
 * 회의 모드 — 고객 앞에서 노트북을 펼칠 때 가릴 것을 가린다
 *
 * **왜 필요한가**: 포착을 첫 화면으로 올리면서 생긴 위험이다.
 * `/crm/today` 에는 그 회사의 **멈춘 딜·기한 지난 할 일**이 떠 있고,
 * 미팅 작업대의 「AI가 찾은 것」에는 **금액 제안이 그대로**(15억 → 40억) 보인다.
 * 회의 중에 그 화면을 여는 것이 이 기획의 목표인데, **상대가 같은 화면을 본다.**
 *
 * 지시에 없던 것이지만 대면 미팅을 전제하면 반드시 생긴다(기획 G-3).
 *
 * **왜 sessionStorage 인가**: 회의 모드는 **지금 이 자리**의 상태이지 취향이 아니다.
 * 서버에 저장하면 다음 날에도 켜져 있고, 그러면 사무실에서 금액이 안 보인다.
 * 탭을 닫으면 꺼지는 것이 맞다.
 *
 * **왜 CRM 레이아웃인가**: 셸(`AppShell`)은 표면 넷이 공유한다. 영업 데이터를 가리는 일은
 * CRM 의 관심사라 거기에 둔다 — 셸에 넣으면 콘텐츠·업무 표면이 쓰지도 않을 것을 들고 다닌다.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

const KEY = 'crm.meetingMode'

interface MeetingModeValue {
  /** 켜져 있나 */
  on: boolean
  toggle: () => void
}

const Ctx = createContext<MeetingModeValue>({ on: false, toggle: () => {} })

export function MeetingModeProvider({ children }: { children: ReactNode }) {
  /**
   * 서버 렌더에서는 언제나 꺼짐으로 시작한다.
   *
   * `sessionStorage` 를 초기값으로 읽으면 서버와 클라이언트가 달라 hydration 이 깨진다.
   * 켜져 있었다면 마운트 직후 한 번 켜진다 — 깜빡임보다 깨지지 않는 쪽이 낫다.
   */
  const [on, setOn] = useState(false)

  useEffect(() => {
    try { setOn(window.sessionStorage.getItem(KEY) === '1') } catch { /* 저장소 차단 환경 */ }
  }, [])

  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev
      try { window.sessionStorage.setItem(KEY, next ? '1' : '0') } catch { /* 저장소 차단 환경 */ }
      return next
    })
  }, [])

  return <Ctx.Provider value={{ on, toggle }}>{children}</Ctx.Provider>
}

export function useMeetingMode(): MeetingModeValue {
  return useContext(Ctx)
}
