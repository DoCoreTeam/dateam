'use client'

/**
 * 「내가 맡은 미완료 부서 업무」 수를 화면 안쪽으로 흘려보내는 통로.
 *
 * **왜 필요한가**(사용자 지적 2026-09-09): 사이드바 「업무」에 빨간 `1` 이 떠서 눌렀는데
 * 일일업무 화면이 열렸고, 그 화면 어디에도 그 1건이 없었다. 배지가 세는 것과
 * 도착지가 서로 다른 말을 한 것이다.
 *
 * 그래서 **같은 숫자를 다음 자리에서 이어 준다** — 사이드바 배지 → 업무 탭 줄의
 * 「부서 업무」 배지 → 그 화면의 「내 담당·미완료」 필터. 시선이 끊기지 않는다.
 *
 * 세는 것은 서버다(`(member)/layout.tsx` 의 `countMyOpenDeptTasks`). 클라이언트가 다시 세면
 * 화면을 열기 전까지 배지가 비어 「볼 것 없음」으로 읽힌다(배지 규칙 4 · `lib/terms/badge.ts`).
 * 레이아웃이 이미 센 값을 그대로 물려주므로 **왕복이 늘지 않는다.**
 */

import { createContext, useContext, type ReactNode } from 'react'

const MyOpenDeptTaskCount = createContext(0)

export function MyOpenDeptTaskProvider({ count, children }: { count: number; children: ReactNode }) {
  return <MyOpenDeptTaskCount.Provider value={count}>{children}</MyOpenDeptTaskCount.Provider>
}

/** 제공자 밖에서는 0 — 배지를 그리지 않는다(0이면 배지를 없앤다) */
export function useMyOpenDeptTaskCount(): number {
  return useContext(MyOpenDeptTaskCount)
}
