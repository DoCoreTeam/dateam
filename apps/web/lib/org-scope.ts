import 'server-only'

/**
 * 조직도(org_nodes) 기반 권한 스코프 해석 — 서버 전용.
 * DB의 private.* SECURITY DEFINER 함수와 동일 로직을 TS로 미러링한다.
 * (private 스키마는 PostgREST에 노출되지 않으므로 서버에서 admin client로 계산)
 */

export interface OrgNode {
  id: string
  type: 'company' | 'role' | 'department' | 'person'
  parent_id: string | null
  head_user_id: string | null
  user_id: string | null
  name: string
}
interface ClosureRow {
  ancestor_id: string
  descendant_id: string
  depth: number
}

export interface OrgScope {
  /** 내가 직접 head인 노드 id (편집/취합 권한) */
  editableDeptIds: string[]
  /** 내가 조회 가능한 부서 노드 id (내 관할 서브트리 + 내 소속부서, 전사면 전체) */
  readableDeptIds: string[]
  /** 전사 권한(대표이사 apex) 여부 */
  isExecutive: boolean
  /** 대시보드 시작 노드(들) */
  scopeRootIds: string[]
  /** 조직도 전체 노드/클로저 (대시보드 트리 구성용) */
  nodes: OrgNode[]
  closure: ClosureRow[]
}

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

/** 부서 취합 대상 = 부서 서브트리 내 모든 person의 user_id */
export function deptMemberUserIds(scope: OrgScope, deptId: string): string[] {
  const subtree = new Set(
    scope.closure.filter((c) => c.ancestor_id === deptId).map((c) => c.descendant_id),
  )
  return scope.nodes
    .filter((n) => n.type === 'person' && n.user_id && subtree.has(n.id))
    .map((n) => n.user_id as string)
}

/** 사용자가 조직 탭을 볼 자격(관할 노드 보유 or 전사) */
export function hasOrgScope(scope: OrgScope): boolean {
  return scope.isExecutive || scope.editableDeptIds.length > 0 || scope.readableDeptIds.length > 0
}

/**
 * 로그인 사용자의 조직도 소속 경로(회사 → 본부 → 팀 …) 이름 배열 — 표시용 SSOT.
 * - 일반 멤버: 본인 person 노드의 조상 체인을 root→근접 순으로(person·role 제외, 즉 회사/부서만).
 *   조직도에 팀이 추가되면 그 깊이만큼 자동 확장된다(본부로 고정하지 않음).
 * - 전사(C레벨): 회사(root) 1개만.
 * - 미소속/노드 없음: 빈 배열 → 호출측이 폴백(인사말) 처리.
 */
export function orgPathFromScope(scope: OrgScope, userId: string): string[] {
  const { nodes, closure, isExecutive } = scope
  const root = nodes.find((n) => n.parent_id === null) ?? null
  if (isExecutive) return root ? [root.name] : []

  // anchor = 본인 person 노드(우선), 없으면 본인이 head인 노드(부서장 등)
  const anchor =
    nodes.find((n) => n.type === 'person' && n.user_id === userId) ??
    nodes.find((n) => n.head_user_id === userId) ??
    null
  if (!anchor) return root ? [root.name] : []

  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  // 조상 행: descendant_id = anchor. depth 큰 것(루트)부터 정렬 → root→near 순.
  const names = closure
    .filter((c) => c.descendant_id === anchor.id)
    .sort((a, b) => b.depth - a.depth)
    .map((c) => byId.get(c.ancestor_id))
    .filter((n): n is OrgNode => !!n && n.type !== 'person' && n.type !== 'role')
    .map((n) => n.name)

  return names.length ? names : root ? [root.name] : []
}

/**
 * 사용자가 특정 부서(이름)에 소속/관할인지 판정 — 서버 전용.
 * true 조건: 본인 person 노드가 그 부서 서브트리 안 · 그 부서(또는 상위)의 head · admin.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isInDivisionByName(admin: any, userId: string, deptName: string, isAdmin = false): Promise<boolean> {
  if (isAdmin) return true
  const { data: nodes = [] } = await admin
    .from('org_nodes')
    .select('id,type,parent_id,head_user_id,user_id,name') as { data: OrgNode[] }
  const { data: closure = [] } = await admin
    .from('org_node_closure')
    .select('ancestor_id,descendant_id') as { data: { ancestor_id: string; descendant_id: string }[] }
  const dept = nodes.find((n) => n.type === 'department' && n.name === deptName)
  if (!dept) return false
  const subtree = new Set(closure.filter((c) => c.ancestor_id === dept.id).map((c) => c.descendant_id))
  const myPersonInSubtree = nodes.some((n) => n.type === 'person' && n.user_id === userId && subtree.has(n.id))
  const deptAndAncestors = new Set(closure.filter((c) => c.descendant_id === dept.id).map((c) => c.ancestor_id))
  const iManageDeptOrAbove = nodes.some((n) => n.head_user_id === userId && deptAndAncestors.has(n.id))
  return myPersonInSubtree || iManageDeptOrAbove
}
