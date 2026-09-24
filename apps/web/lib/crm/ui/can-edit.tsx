'use client'

/**
 * 「이 사람이 무엇을 할 수 있나」 — 설정 화면 한 벌의 단일 답.
 *
 * **왜 값을 한곳에 두나**: 설정 카드가 열넷인데 권한을 받는 카드가 둘뿐이었다.
 * 나머지 열둘은 관리자가 아닌 사람에게도 「추가」·「저장」·「삭제」를 그려 놓고,
 * 누르면 서버가 403 을 돌려줬다. 못 하는 일을 할 수 있는 것처럼 그려 놓고 거절하는 것은
 * 안내가 아니라 함정이다 — 사람은 자기가 뭘 잘못했는지부터 찾는다.
 *
 * **감추는 것이 전부다.** 서버 판정은 그대로 둔다(LOOP.md 7절 S2) — 화면에서 감추는 것으로
 * 권한을 대신하면, 화면을 안 거치는 호출에는 아무 방벽이 없다.
 * 여기서 정하는 것은 «못 누를 버튼을 그리지 않는 것»뿐이다.
 *
 * **셋으로 나눈 이유**: 카드마다 서버가 요구하는 것이 다르다(실측 2026-09-23).
 * 파이프라인·사업 유형·거래 조건·예산·자동화·필드·중복 정리는 ADMIN 이고,
 * 가져오기·데이터 점검·연동은 MEMBER 이며, 내보내기는 역할이 아니라 **부여**가 정한다.
 * 하나로 묶어 ADMIN 으로 감추면 멤버가 **할 수 있는 일까지** 사라진다 — 반대 방향의 같은 실수다.
 *
 * 판정 자체는 서버가 한다(`hasCrmRole` · `canExport`). 여기는 그 답을 들고만 있는다 —
 * 등급 비교를 화면이 다시 적으면 규칙이 두 벌이 된다.
 */

import { createContext, useContext, type ReactNode } from 'react'

export interface CrmSettingsAbility {
  /** 설정을 바꿀 수 있나 (서버 ADMIN 창구) */
  canEdit: boolean
  /** 데이터를 손볼 수 있나 (서버 MEMBER 창구 — 가져오기·점검·연동) */
  canWrite: boolean
  /** 파일로 뺄 수 있나 (역할이 아니라 부여가 정한다) */
  canExport: boolean
}

/**
 * 못 하는 사람으로 **기본값을 잡는다.**
 *
 * 문맥 밖에서 부르면 전부 `false` 다 — 기본이 `true` 면 감싸는 것을 잊은 화면이
 * 조용히 전원에게 단추를 그린다. 빠뜨렸을 때 안전한 쪽으로 기운다.
 */
const NOTHING: CrmSettingsAbility = { canEdit: false, canWrite: false, canExport: false }

const AbilityContext = createContext<CrmSettingsAbility>(NOTHING)

/** 설정을 바꾸는 카드가 부른다 (서버 ADMIN) */
export function useCanEdit(): boolean {
  return useContext(AbilityContext).canEdit
}

/** 데이터를 손보는 카드가 부른다 (서버 MEMBER) */
export function useCanWrite(): boolean {
  return useContext(AbilityContext).canWrite
}

/** 내보내기 카드가 부른다 (부여 기반) */
export function useCanExport(): boolean {
  return useContext(AbilityContext).canExport
}

export function CanEditProvider({ value, children }: { value: CrmSettingsAbility; children: ReactNode }) {
  return <AbilityContext.Provider value={value}>{children}</AbilityContext.Provider>
}
