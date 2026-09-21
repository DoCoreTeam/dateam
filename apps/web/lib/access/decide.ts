/**
 * 접근 판정 — **한 사람이 한 표면에 들어갈 수 있나**
 *
 * 숨기는 쪽(메뉴)과 막는 쪽(라우트)이 **같은 함수**를 부르게 하려고 따로 뺐다.
 * 두 쪽이 각자 판정하면 반드시 갈린다 — 갈린 결과가 「메뉴엔 보이는데 막히는 문」이었다.
 *
 * 순서가 규칙의 전부다. 위에서부터 답이 나오면 거기서 끝난다.
 *
 *   1 관리자    — 항상 통과. 관리자를 잠그면 열어 줄 사람이 사라진다
 *   2 차단      — 막음이 하나라도 있으면 막는다. 열어 준 것보다 막은 것이 세다
 *   3 사람      — 그 사람에게 준 열기
 *   4 조직      — 그 사람이 속한 부서에 준 열기
 *   5 기본값    — 부여가 없을 때의 등재부 값
 *
 * 부여가 0건이면 5번만 남는다. 즉 **아무것도 부여하지 않으면 지금과 같다.**
 */

import { surfaceByKey } from './surfaces.ts'

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
  surfaceKey: string,
  viewer: Viewer,
  grants: readonly Grant[],
): Decision {
  // 1 관리자
  if (viewer.isAdmin) return { allowed: true, reason: 'admin' }

  /**
   * 등재 안 된 표면은 막는다.
   *
   * 열어 두면 화면을 새로 만들고 등재를 잊은 순간 **아무 표시 없이 전부에게 열린다.**
   * 막아 두면 그 화면이 안 보이므로 만든 사람이 바로 안다.
   * 등재를 잊는 것 자체는 `lib/policy/access-surface.test.ts` 가 커밋 전에 잡는다.
   */
  const surface = surfaceByKey(surfaceKey)
  if (!surface) return { allowed: false, reason: 'unregistered' }

  const mine = grants.filter((g) => g.surfaceKey === surfaceKey && matches(g.subject, viewer))

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

  // 5 기본값
  return { allowed: surface.defaultAudience === 'all', reason: 'default' }
}
