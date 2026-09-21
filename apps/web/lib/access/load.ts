import 'server-only'

/**
 * 부여 읽기 — **이 요청의 사람에게 걸린 것만** 가져온다
 *
 * ## 왜 여기서 좁히나
 *
 * 판정 함수(`decide.ts`)는 순수하다. 조직이 위아래로 이어져 있다는 사실을 모른다.
 * 그 사실은 DB 에 있으므로 여기서 풀어서 넘긴다 — 「본부에 열면 팀도 열린다」를
 * 판정 함수가 알게 만들면 판정이 조직도 구조에 묶여 시험할 수 없게 된다.
 *
 * ## 왕복 셋
 *
 * 내 사람 노드 → 그 조상들 → 그 주체들에게 걸린 부여. 셋 다 작고 인덱스가 있다.
 * 소속이 없으면 조상 질의를 건너뛰어 둘이 된다.
 * 그리고 `cache()` 로 싸서 **한 요청 안에서는 한 번만** 돈다
 * (`lib/auth/request-profile.ts` 가 같은 이유로 같은 장치를 쓴다).
 *
 * ## 부여가 0건이면
 *
 * 돌아오는 목록이 비고, 판정은 표면 기본값만 쓴다 — 즉 **지금 화면과 같다.**
 *
 * 순수한 부분(걸리는가·바꾸는 일)은 `load-pure.ts` 에 있다 — 여기는 조회만 맡는다.
 */

import { cache } from 'react'
import { createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { collectViewerAccess, type AccessSource, type GrantRow, type ViewerAccess } from './load-pure.ts'

export type { GrantRow, ViewerAccess, OrgMembership } from './load-pure.ts'
export { appliesToMe, toGrants, collectViewerAccess } from './load-pure.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */
export function dbSource(admin: any): AccessSource {
  return {
    async myOrgs(userId) {
      const { data: mine } = await admin
        .from('org_nodes')
        .select('parent_id')
        .eq('type', 'person')
        .eq('user_id', userId)
      const direct = ((mine ?? []) as { parent_id: string | null }[])
        .map((n) => n.parent_id)
        .filter((id): id is string => Boolean(id))
      if (direct.length === 0) return { direct, withAncestors: direct }

      const { data: anc } = await admin
        .from('org_node_closure')
        .select('ancestor_id')
        .in('descendant_id', direct)
      const withAncestors = [
        ...new Set([...direct, ...((anc ?? []) as { ancestor_id: string }[]).map((r) => r.ancestor_id)]),
      ]
      return { direct, withAncestors }
    },
    async rows(subjectIds) {
      if (subjectIds.length === 0) return []
      const { data } = await admin
        .from('access_grant')
        .select('surface_key, subject_kind, subject_id, effect, include_descendants')
        .in('subject_id', subjectIds)
      return (data ?? []) as GrantRow[]
    },
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 로그인 안 했으면 null. 화면은 그 경우 이미 로그인으로 보낸다 */
export const loadViewerAccess = cache(async (): Promise<ViewerAccess | null> => {
  const user = await getRequestUser()
  if (!user) return null
  const profile = await getRequestProfile()
  const isAdmin = profile?.role === 'admin'
  try {
    return await collectViewerAccess(user.id, isAdmin, dbSource(createAdminClient()))
  } catch {
    /**
     * 못 읽었다고 화면이 죽지 않는다 — **부여가 없는 것과 같게** 둔다.
     * 그러면 표면 기본값만 남고, 그것은 이 기능이 생기기 전과 같은 화면이다.
     * 여기서 「전부 열림」으로 떨어지면 조회 실패가 곧 권한 누출이 된다.
     */
    return { viewer: { userId: user.id, isAdmin, orgIds: [] }, grants: [] }
  }
})
