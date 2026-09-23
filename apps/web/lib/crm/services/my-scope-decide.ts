/**
 * 「내 것」이 어디까지인가 — 판정만 한다.
 *
 * 읽는 일(조직도·멤버 목록)은 `my-scope.ts` 가 하고 여기는 **값으로만** 정한다.
 * 그래야 시험이 가짜 조직도를 넣어 볼 수 있다 — 읽기와 판정이 한 파일에 있으면
 * 서버 전용 모듈이 딸려 와서 시험에서 아예 못 부른다(I07·I08 에서 같은 이유로 갈랐다).
 *
 * **기본은 좁게.** 목적은 남의 것을 못 보게 막는 것이 아니라 **내 것이 먼저 보이게** 하는 것이다.
 * 그래서 막지 않고 기본 필터로 푼다 — 범위가 넓은 사람은 탭으로 넓힌다.
 */

import type { AttentionScope } from './attention.ts'
import { ALL_USERS } from './owner-decide.ts'

/** 화면이 그릴 수 있는 탭 — 범위가 좁은 사람에게는 넓은 탭을 안 보여 준다 */
export type ScopeTab = 'mine' | 'dept' | 'all'

export interface MyScope {
  /** 나 하나 */
  mine: AttentionScope
  /** 내 권한 범위 전체. 전사면 제한 없음 */
  reachable: AttentionScope
  /** 이 사람에게 보여 줄 탭들. 범위가 자기뿐이면 「내 담당」 하나뿐이다 */
  tabs: readonly ScopeTab[]
}

/** 판정에 필요한 멤버의 최소 정보 — 이름이나 직함은 여기서 안 본다 */
export interface ScopeMember {
  memberId: string
  hostUserId: string
  active: boolean
}

export interface DecideMyScopeInput {
  myMemberId: string
  /**
   * 이 모듈 안에서 **관리자**인가(OWNER·ADMIN).
   *
   * 범위는 조직도가 SSOT 지만, 조직도는 회사의 모양이지 이 모듈의 권한이 아니다 —
   * 실측 2026-09-23: CRM 소유자(김도현)가 조직도에서는 한 부서의 장이라
   * 조직도만 보면 **소유자가 자기 부서 밖을 못 본다.** 관리자는 전사로 본다.
   */
  admin?: boolean
  members: readonly ScopeMember[]
  /**
   * 내가 손댈 수 있는 **호스트 사용자** id 들(`reachableUserIds`).
   * 조직도를 못 읽었으면 `null` — 그때는 **내 것만** 본다.
   * 실패했을 때 전체로 기울면 조직도가 잠깐 비는 순간 모두가 모든 것을 본다.
   */
  reach: readonly string[] | typeof ALL_USERS | null
}

/**
 * 범위를 **멤버 id 집합**으로 만든다.
 *
 * 조직도는 호스트 사용자 id 를 돌려주는데 CRM 의 담당자 칸은 멤버 id 다.
 * 그 대조를 안 하고 그대로 조건에 넣으면 아무것도 안 걸려 목록이 통째로 빈다.
 */
export function decideMyScope(input: DecideMyScopeInput): MyScope {
  const mine: AttentionScope = { ownerMemberIds: [input.myMemberId] }
  const onlyMine: MyScope = { mine, reachable: mine, tabs: ['mine'] }

  if (input.admin || input.reach === ALL_USERS) {
    return { mine, reachable: { ownerMemberIds: null }, tabs: ['mine', 'all'] }
  }
  if (input.reach === null) return onlyMine

  const reachSet = new Set(input.reach)
  const memberIds = input.members
    .filter((m) => m.active && reachSet.has(m.hostUserId))
    .map((m) => m.memberId)

  // 나 말고 걸리는 사람이 없으면 「부서 전체」 탭은 「내 담당」과 같은 답이라 안 그린다
  const wider = memberIds.some((id) => id !== input.myMemberId)
  if (!wider) return onlyMine

  return { mine, reachable: { ownerMemberIds: memberIds }, tabs: ['mine', 'dept'] }
}

/**
 * 화면이 보낸 탭 이름을 **이 사람이 실제로 열 수 있는 탭**으로 맞춘다.
 *
 * 모르는 이름이나 허용 안 된 이름이 오면 가장 좁은 것으로 본다 —
 * 주소창에 `?scope=all` 을 손으로 적어 넣어도 범위가 안 넓어진다.
 */
export function activeTab(my: MyScope, tab: string | null | undefined): ScopeTab {
  return my.tabs.find((t) => t === tab) ?? 'mine'
}

/** 탭 하나를 조건으로 바꾼다 */
export function scopeOfTab(my: MyScope, tab: string | null | undefined): AttentionScope {
  return activeTab(my, tab) === 'mine' ? my.mine : my.reachable
}
