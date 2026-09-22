/**
 * 조직도 한 벌을 읽는다 — 권한 범위와 담당자 승계가 같은 스냅샷을 쓴다
 *
 * **왜 따로 두나**: 범위 판정(`owner-decide.ts`)과 승계 판정(`owner-fallback.ts`)이 둘 다
 * 조직도를 본다. 각자 읽으면 요청 하나에 조직도를 두 번 읽고, 더 나쁘게는 **두 판정이 서로 다른
 * 조직도를 볼 수 있다.** 그러면 「바꿀 수 있다고 해서 바꿨는데 다른 사람에게 갔다」가 된다.
 *
 * 요청 안에서는 한 번만 읽는다(React cache). 조직도는 자주 안 바뀌고 행이 수십 개다.
 */

import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '../../supabase/server.ts'
import type { OrgNode, ClosureRow } from '../../org-scope-pure.ts'

export interface OrgSnapshot {
  nodes: readonly OrgNode[]
  closure: readonly ClosureRow[]
}

/** 조직도가 비어도 던지지 않는다 — 담당자 판정이 멈추면 목록 전체가 안 뜬다 */
export const loadOrgSnapshot = cache(async (): Promise<OrgSnapshot> => {
  try {
    const admin = createAdminClient()
    const [nodesRes, closureRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any).from('org_nodes').select('id,type,parent_id,head_user_id,user_id,name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any).from('org_node_closure').select('ancestor_id,descendant_id,depth'),
    ])
    return {
      nodes: (nodesRes.data ?? []) as OrgNode[],
      closure: (closureRes.data ?? []) as ClosureRow[],
    }
  } catch {
    return { nodes: [], closure: [] }
  }
})
