/**
 * 접근 판정 — **한 사람이 한 표면에 들어갈 수 있나**
 *
 * 숨기는 쪽(메뉴)과 막는 쪽(라우트)이 **같은 함수**를 부르게 하려고 따로 뺐다.
 * 두 쪽이 각자 판정하면 반드시 갈린다 — 갈린 결과가 「메뉴엔 보이는데 막히는 문」이었다.
 *
 * 순서가 규칙의 전부다. 위에서부터 답이 나오면 거기서 끝난다.
 *
 *   0 좁은 것    — 자리(`surfaces.ts` 의 `Zone`)와 동작(`actions.ts`)이 붙은 키를 먼저 본다.
 *                  좁은 자리의 그 동작 → 표면의 그 동작 → 그 자리 → 표면 순이다
 *   1 관리자    — 항상 통과. 관리자를 잠그면 열어 줄 사람이 사라진다
 *   2 차단      — 막음이 하나라도 있으면 막는다. 열어 준 것보다 막은 것이 세다
 *   3 사람      — 그 사람에게 준 열기
 *   4 조직      — 그 사람이 속한 부서에 준 열기
 *   5 기본값    — 부여가 없을 때의 등재부 값
 *
 * 부여가 0건이면 5번만 남는다. 즉 **아무것도 부여하지 않으면 지금과 같다.**
 */

import { splitKey, surfaceByKey } from './surfaces.ts'
import { splitAction } from './actions.ts'

export type SubjectKind = 'user' | 'org'

export interface GrantSubject {
  kind: SubjectKind
  /** user 면 profiles.id, org 면 org_nodes.id */
  id: string
}

export interface Grant {
  surfaceKey: string
  subject: GrantSubject
  effect: 'allow' | 'deny'
}

export interface Viewer {
  userId: string
  isAdmin: boolean
  /** 이 사람이 속한 조직 노드들. 상위 노드까지 펼쳐서 넘긴다 */
  orgIds: readonly string[]
}

/** 왜 그렇게 판정했나 — 화면이 사유를 말할 수 있어야 한다(AccessDenied) */
export type DecisionReason = 'admin' | 'denied' | 'user' | 'org' | 'default' | 'unregistered'

export interface Decision {
  allowed: boolean
  reason: DecisionReason
}

function matches(subject: GrantSubject, viewer: Viewer): boolean {
  if (subject.kind === 'user') return subject.id === viewer.userId
  return viewer.orgIds.includes(subject.id)
}

export function decideAccess(
  key: string,
  viewer: Viewer,
  grants: readonly Grant[],
): Decision {
  // 1 관리자
  if (viewer.isAdmin) return { allowed: true, reason: 'admin' }

  /**
   * 여기는 **들어갈 수 있나**만 답한다. 동작(`#write`·`#export`)은 다른 질문이라
   * `actions.ts` 의 `vetoesAction` 이 따로 답한다 — 섞으면 답이 틀린다.
   *
   * 왜 틀리나: 동작을 여기서 답하게 하면 표면 기본값이 동작에도 내려온다.
   * `crm` 은 기본값이 관리자인데 CRM 셸은 **멤버면 들여보낸다**(축이 다르다).
   * 그러면 일반 사용자 CRM 멤버가 내보내기에서 막힌다 — 아무도 차단을 안 적었는데.
   * 그래서 동작 키는 여기 오면 안 되고, 오면 막는다.
   */
  if (key.includes('#')) return { allowed: false, reason: 'unregistered' }
  const base = key

  const { surfaceKey } = splitKey(base)

  /**
   * 등재 안 된 표면은 막는다.
   *
   * 열어 두면 화면을 새로 만들고 등재를 잊은 순간 **아무 표시 없이 전부에게 열린다.**
   * 막아 두면 그 화면이 안 보이므로 만든 사람이 바로 안다.
   * 등재를 잊는 것 자체는 `lib/policy/access-surface.test.ts` 가 커밋 전에 잡는다.
   *
   * **구역은 여기서 안 따진다.** 등재 안 된 구역도 판정은 된다 — 부여가 없을 뿐이고,
   * 그러면 아래에서 표면 값이 그대로 내려온다. 그것이 「구역을 안 건드린 부여는
   * 표면 값이 그대로 내려간다」의 실제 구현이다.
   */
  const surface = surfaceByKey(surfaceKey)
  if (!surface) return { allowed: false, reason: 'unregistered' }

  /**
   * **좁은 것부터 넓은 것으로** 훑는다. 자리 → 표면 순이다.
   * 어느 한 단계에서 내 부여가 있으면 거기서 끝난다. 하나도 없으면 표면 기본값이 내려온다 —
   * 그것이 「안 건드린 부여는 표면 값이 그대로 내려간다」의 실제 구현이다.
   */
  for (const candidate of zoneBases(base)) {
    const hit = decideFrom(grants, candidate, viewer)
    if (hit) return hit
  }

  // 5 기본값
  return { allowed: surface.defaultAudience === 'all', reason: 'default' }
}

/** `crm:quotes` → `['crm:quotes', 'crm']`. 자리가 없으면 표면 하나뿐이다 */
function zoneBases(base: string): string[] {
  const { surfaceKey, zone } = splitKey(base)
  return zone === null ? [surfaceKey] : [base, surfaceKey]
}


/**
 * 키 하나에 걸린 내 부여로 답이 나오나. 없으면 `null` 이고 부르는 쪽이 한 단계 넓힌다.
 *
 * 순서는 2 차단 · 3 사람 · 4 조직이다 — 막음이 열기를 이기고, 사람이 조직보다 가깝다.
 */
function decideFrom(grants: readonly Grant[], key: string, viewer: Viewer): Decision | null {
  const mine = grants.filter((g) => g.surfaceKey === key && matches(g.subject, viewer))
  if (mine.length === 0) return null

  // 2 차단
  if (mine.some((g) => g.effect === 'deny')) return { allowed: false, reason: 'denied' }

  // 3 사람
  if (mine.some((g) => g.effect === 'allow' && g.subject.kind === 'user')) {
    return { allowed: true, reason: 'user' }
  }

  // 4 조직
  if (mine.some((g) => g.effect === 'allow' && g.subject.kind === 'org')) {
    return { allowed: true, reason: 'org' }
  }

  return null
}
