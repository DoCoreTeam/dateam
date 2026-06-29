/**
 * 조직도(org_nodes) 스코프 — 순수 로직(SSOT). DB 접근 없는 함수/타입만 둔다(테스트 가능).
 * 서버 전용 DB 해석(resolveOrgScope 등)은 org-scope.ts(server-only)에 있으며 이 모듈을 재사용한다.
 */

export interface OrgNode {
  id: string
  type: 'company' | 'role' | 'department' | 'person'
  parent_id: string | null
  head_user_id: string | null
  user_id: string | null
  name: string
}
export interface ClosureRow {
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

/**
 * 부서 취합 대상 = 부서 서브트리 내 모든 person의 user_id + 서브트리 노드의 head_user_id(부서장·본부장).
 * 부서장은 person 자식 노드 없이 부서/본부 노드의 head_user_id로만 연결될 수 있으므로(조직도 정의상 부서 구성원),
 * person만으로 산출하면 취합에서 누락된다. 두 경로를 합집합(중복 제거)해 어드민·멤버 취합이 동일 결과를 갖는다.
 */
export function deptMemberUserIds(scope: OrgScope, deptId: string): string[] {
  const subtree = new Set(
    scope.closure.filter((c) => c.ancestor_id === deptId).map((c) => c.descendant_id),
  )
  subtree.add(deptId) // closure self-row 미존재 대비 — 선택 부서 노드 자신(=부서장) 포함 보장
  const ids = new Set<string>()
  for (const n of scope.nodes) {
    if (!subtree.has(n.id)) continue
    if (n.type === 'person' && n.user_id) ids.add(n.user_id) // 일반 구성원
    if (n.head_user_id) ids.add(n.head_user_id) // 그 노드의 장(부서장·본부장 등)
  }
  return Array.from(ids)
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
