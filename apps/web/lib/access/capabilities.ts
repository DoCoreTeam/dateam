/**
 * 값과 범위 — **무엇을 보나**와 **누구의 것을 보나**
 *
 * 표면·자리는 「어디」, 동작은 「무엇까지」를 답했다. 남은 둘이 여기 있다.
 *
 *   · **값(능력)** — 같은 화면 안에서도 어떤 칸은 보이고 어떤 칸은 안 보인다.
 *     원가·마진이 그 자리다. 화면을 열어 줬다고 원가까지 열어 준 것은 아니다.
 *   · **범위** — 같은 목록에서도 내 것만 보는 사람과 부서 것을 보는 사람이 다르다.
 *
 * ## 왜 여기로 올렸나
 *
 * 능력 다섯은 CRM 안에만 있었다(`lib/crm/security/sensitivity.ts`). 그런데 값이 새는 자리는
 * CRM 만이 아니다 — 견적·주간보고·RFP 도 금액을 다룬다. 이름을 서비스 안에 두면
 * 두 번째 서비스가 같은 뜻에 다른 이름을 붙이고, 그때부터 「원가를 볼 수 있는 사람」이
 * 서비스마다 다른 말이 된다.
 *
 * **CRM 이 이 목록을 읽는다. 여기서 복사해 가지 않는다** — 복사는 갈린다.
 *
 * ## 여기서 판정하지 않는다
 *
 * 값의 판정은 `lib/crm/security/sensitivity.ts` 가 계속 한다(필드 등급표가 거기 있다).
 * 범위의 판정은 `lib/org-scope.ts` 가 계속 한다(조직도가 거기 있다).
 * 여기 있는 것은 **이름과 셈법**뿐이다 — 판정을 여기로 옮기면 두 벌이 된다.
 */

import type { OrgScope } from '../org-scope-pure.ts'

/**
 * 능력 — 역할을 늘리지 않고 **사람마다 더하거나 뺀다.**
 *
 * 역할을 늘리는 쪽으로 가면 「원가는 보되 승인은 못 하는 사람」이 필요할 때마다 역할이 하나씩 는다.
 * 능력은 곱셈이라 역할이 안 는다.
 */
export type Capability =
  | 'cost.view'
  | 'cost.edit'
  | 'margin.view'
  | 'quote.send'
  | 'quote.approve'

export const CAPABILITIES: readonly Capability[] = [
  'cost.view', 'cost.edit', 'margin.view', 'quote.send', 'quote.approve',
]

/**
 * 범위 셋 — **누구의 것을 보나.**
 *
 * 셋뿐이다. 늘리면 관리자가 외워야 할 조합이 늘고, 조합이 늘면 아무도 정확히 무엇을
 * 준 건지 모르게 된다. 조직도가 이미 계층을 아는데 범위까지 계층을 흉내 내면 두 벌이 된다.
 */
export type AccessRange = 'self' | 'dept' | 'all'

export const RANGES: readonly AccessRange[] = ['self', 'dept', 'all']

/**
 * 조직 스코프가 곧 범위다 — **여기서 다시 정하지 않는다.**
 *
 *   전사  — 대표이사 apex. 모든 부서를 읽는다
 *   부서  — 내가 head 인 노드가 있다. 그 서브트리를 읽는다
 *   내 것 — 관할이 없다. 내 것과 내 소속 부서의 읽기뿐이다
 *
 * **왜 `readableDeptIds` 로 안 가르나**: 평사원도 자기 소속 부서가 `readableDeptIds` 에 든다.
 * 그걸로 가르면 전원이 「부서」가 되어 범위가 둘로 줄어든다.
 * 가르는 것은 **책임지는 자리가 있는가**다(`editableDeptIds`).
 */
export function rangeOfScope(scope: OrgScope): AccessRange {
  if (scope.isExecutive) return 'all'
  return scope.editableDeptIds.length > 0 ? 'dept' : 'self'
}

/**
 * 그 범위가 실제로 닿는 부서 — 화면이 「몇 개 부서」라고 말할 수 있게.
 *
 * 스코프가 이미 계산해 둔 값을 고르기만 한다. 여기서 다시 세면 조직도가 바뀔 때
 * 두 셈법이 갈린다.
 */
export function deptIdsOfRange(scope: OrgScope, range: AccessRange): string[] {
  if (range === 'self') return []
  return scope.readableDeptIds
}

/**
 * 조직도 원본만으로 한 사람의 범위를 구한다 — **스코프를 못 만드는 자리에서 쓴다.**
 *
 * 관리자 화면은 사람 수십 명의 범위를 한 번에 그린다. 사람마다 `resolveOrgScope` 를 부르면
 * 조직도 전체를 사람 수만큼 다시 읽는다. 규칙은 `lib/org-scope.ts` 의 그것과 **같은 두 줄**이다 —
 * 루트나 루트 직속에 걸려 있으면 전사, 어떤 노드의 head 면 부서, 아니면 내 것.
 */
export function rangeOfPerson(
  userId: string,
  nodes: readonly { id: string; type: string; parent_id: string | null; head_user_id: string | null; user_id: string | null }[],
): AccessRange {
  const root = nodes.find((n) => n.parent_id === null) ?? null
  const directChildrenOfRoot = root ? nodes.filter((n) => n.parent_id === root.id) : []
  const isExecutive =
    (!!root && root.head_user_id === userId) ||
    directChildrenOfRoot.some(
      (c) =>
        c.head_user_id === userId ||
        (c.type === 'person' && c.user_id === userId) ||
        nodes.some((pc) => pc.parent_id === c.id && pc.type === 'person' && pc.user_id === userId),
    )
  if (isExecutive) return 'all'

  // 사람 노드는 head 가 될 수 없다 — 부서·본부·역할 노드의 장만 관할을 갖는다
  const leads = nodes.some((n) => n.head_user_id === userId && n.type !== 'person')
  return leads ? 'dept' : 'self'
}
