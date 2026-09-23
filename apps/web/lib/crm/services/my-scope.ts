/**
 * 「내 것」이 어디까지인가 — 조직도와 멤버 목록을 읽어 판정에 넘긴다.
 *
 * 범위는 조직도가 정한다(`rangeOfPerson` → `reachableUserIds`). 그런데 CRM 의 담당자 칸은
 * **멤버 id** 라, 조직이 돌려주는 호스트 사용자 id 를 그대로 조건에 넣으면 아무것도 안 걸린다.
 * 그 대조는 `my-scope-decide.ts` 가 값으로만 한다 — 여기는 읽기만 한다.
 */

import 'server-only'
import type { CrmDb } from '../db/client.ts'
import { reachableUserIds } from './owner-decide.ts'
import { loadOrgSnapshot } from './org-snapshot.ts'
import { loadMemberDisplays } from './member-display.ts'
import { decideMyScope, type MyScope } from './my-scope-decide.ts'
import { hasCrmRole, type CrmRole } from '../auth/requireCrmMember.ts'

export { activeTab, scopeOfTab, listTabs, listActiveTab, listScopeOf } from './my-scope-decide.ts'
export type { MyScope, ScopeTab } from './my-scope-decide.ts'

/**
 * 지금 보는 사람의 범위를 멤버 id 집합으로 만든다.
 *
 * 조직도를 못 읽어도 멈추지 않는다 — 그때는 **내 것만** 보여 준다.
 */
export async function loadMyScope(db: CrmDb, myMemberId: string, role: CrmRole): Promise<MyScope> {
  // 관리자는 조직도와 무관하게 전사다 — 조직도는 회사의 모양이지 이 모듈의 권한이 아니다
  const admin = hasCrmRole(role, 'ADMIN')

  const members = await loadMemberDisplays(db)
  const me = members.get(myMemberId)
  if (!me?.hostUserId) return decideMyScope({ myMemberId, members: [], reach: null, admin })

  const org = await loadOrgSnapshot()
  // 조직도가 비면 판정이 「나만」으로 떨어진다. 비었는데 전사로 읽으면 그게 사고다
  const reach = org.nodes.length ? reachableUserIds(me.hostUserId, org) : null

  return decideMyScope({
    myMemberId,
    admin,
    members: [...members.values()].map((m) => ({
      memberId: m.memberId, hostUserId: m.hostUserId, active: m.active,
    })),
    reach,
  })
}
