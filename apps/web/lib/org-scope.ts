import 'server-only'
import type { OrgNode, ClosureRow, OrgScope } from './org-scope-pure'

/**
 * 조직도(org_nodes) 기반 권한 스코프 해석 — 서버 전용.
 * DB의 private.* SECURITY DEFINER 함수와 동일 로직을 TS로 미러링한다.
 * (private 스키마는 PostgREST에 노출되지 않으므로 서버에서 admin client로 계산)
 * 순수 함수/타입(deptMemberUserIds·hasOrgScope·orgPathFromScope·OrgNode 등)은 org-scope-pure.ts(SSOT)에서 재export.
 */

// 순수 로직·타입은 org-scope-pure(테스트 가능)에서 재export — 기존 '@/lib/org-scope' import 호환 유지
export type { OrgNode, ClosureRow, OrgScope } from './org-scope-pure'
export { deptMemberUserIds, hasOrgScope, orgPathFromScope } from './org-scope-pure'

const LEADER_TYPES = ['department', 'role', 'company']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveOrgScope(admin: any, userId: string): Promise<OrgScope> {
  const { data: nodes = [] } = await admin
    .from('org_nodes')
    .select('id,type,parent_id,head_user_id,user_id,name') as { data: OrgNode[] }
  const { data: closure = [] } = await admin
    .from('org_node_closure')
    .select('ancestor_id,descendant_id,depth') as { data: ClosureRow[] }

  const root = nodes.find((n) => n.parent_id === null) ?? null
  const descendantsOf = (id: string) =>
    closure.filter((c) => c.ancestor_id === id).map((c) => c.descendant_id)

  // 내가 head인 노드
  const managed = nodes.filter(
    (n) => n.head_user_id === userId && LEADER_TYPES.includes(n.type),
  )
  const managedIds = managed.map((n) => n.id)

  // 전사(apex): 루트 head, 또는 루트 직속 노드(대표이사 role 등)의 head/person-child/본인 person
  const directChildrenOfRoot = root ? nodes.filter((n) => n.parent_id === root.id) : []
  const isExecutive =
    (!!root && root.head_user_id === userId) ||
    directChildrenOfRoot.some(
      (c) =>
        c.head_user_id === userId ||
        (c.type === 'person' && c.user_id === userId) ||
        nodes.some((pc) => pc.parent_id === c.id && pc.type === 'person' && pc.user_id === userId),
    )

  // readable = 관할 서브트리 전체 + 내 소속부서
  const readable = new Set<string>()
  for (const m of managedIds) for (const d of descendantsOf(m)) readable.add(d)
  for (const p of nodes.filter((n) => n.type === 'person' && n.user_id === userId)) {
    if (p.parent_id) readable.add(p.parent_id)
  }

  // editable = 내가 직접 head인 노드 (자기 부서)
  const editableDeptIds = [...managedIds]

  // scopeRoots = 관할 노드 중 부모가 관할집합에 없는 것
  let scopeRootIds = managed
    .filter((m) => !m.parent_id || !managedIds.includes(m.parent_id))
    .map((m) => m.id)

  // 팀원(관할 노드 없음): 본인 소속 부서를 대시보드 시작점으로 (조회 전용)
  if (scopeRootIds.length === 0 && !isExecutive) {
    const myDepts = nodes
      .filter((n) => n.type === 'person' && n.user_id === userId && n.parent_id)
      .map((n) => n.parent_id as string)
    scopeRootIds = Array.from(new Set(myDepts))
  }

  if (isExecutive) {
    // 전사: 모든 부서 노드 readable + 대시보드는 루트에서 시작
    nodes.filter((n) => n.type === 'department').forEach((n) => readable.add(n.id))
    if (root) scopeRootIds = [root.id]
  }

  return {
    editableDeptIds,
    readableDeptIds: Array.from(readable),
    isExecutive,
    scopeRootIds,
    nodes,
    closure,
  }
}

// deptMemberUserIds·hasOrgScope·orgPathFromScope는 org-scope-pure(SSOT)에서 정의·재export(상단 line 13).
// 중복 정의 금지 — 순수 로직은 org-scope-pure.ts 한 곳에서만 유지한다.

// (제거됨) isInDivisionByName — isAdmin 우회/상위 조상 관할 누수로 '소속 전용' 게이트에 부적합.
//   → isMemberOfDivisionByName(아래)로 대체. admin·상위 관할 없이 '서브트리 소속/내부 head'만 판정.

/**
 * 부서 '내부' 소속 판정 — 그 부서(및 하위) 서브트리 안의 소속 person이거나, 서브트리 노드의 head(본부장·팀장).
 * 상위(전사 등 조상) 관할자·admin은 제외(false) — 즉 '위에서 관할'은 소속으로 치지 않는다.
 * (예: AX사업본부 배지 — AX 소속·AX본부장은 노출, 전사 대표이사·타조직은 비노출.)
 * 본부장처럼 person 노드 없이 head_user_id로만 연결된 경우도 포함하기 위해 dept.id를 서브트리에 포함한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isMemberOfDivisionByName(admin: any, userId: string, deptName: string): Promise<boolean> {
  const { data: nodes = [] } = await admin
    .from('org_nodes')
    .select('id,type,user_id,head_user_id,name') as { data: OrgNode[] }
  const { data: closure = [] } = await admin
    .from('org_node_closure')
    .select('ancestor_id,descendant_id') as { data: { ancestor_id: string; descendant_id: string }[] }
  const dept = nodes.find((n) => n.type === 'department' && n.name === deptName)
  if (!dept) return false
  const subtree = new Set(closure.filter((c) => c.ancestor_id === dept.id).map((c) => c.descendant_id))
  subtree.add(dept.id) // closure에 self-row 없을 경우 대비(본부장=dept head 포함 보장)
  const memberPerson = nodes.some((n) => n.type === 'person' && n.user_id === userId && subtree.has(n.id))
  const headInSubtree = nodes.some((n) => subtree.has(n.id) && n.head_user_id === userId) // 본부장·하위 팀장
  return memberPerson || headInSubtree
}
