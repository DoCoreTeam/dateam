/**
 * 동작 — **그 자리에서 무엇까지 할 수 있나**
 *
 * ## 왜 자리만으로는 부족한가
 *
 * 표면(`surfaces.ts`)과 자리(`Zone`)는 **들어갈 수 있나**를 답한다. 그런데 실제 사고는
 * 들어간 다음에 난다 — 들어가서 **내보낸다.** 목록을 열람할 사람에게 화면을 열어 줬는데
 * CSV 단추 하나로 고객 전부가 파일이 되어 나가는 것이 그 모양이다.
 *
 * 그래서 축을 하나 더 둔다. 자리가 「어디」라면 동작은 「무엇까지」다.
 *
 * ## 세 가지뿐이다
 *
 * 늘리지 않는다. 동작이 늘면 관리자가 외워야 할 조합이 늘고, 조합이 늘면 아무도
 * 정확히 무엇을 준 건지 모르게 된다. 세 개는 사람이 한 번에 읽을 수 있는 수다.
 *
 * ## 기본값은 «보기와 같다»
 *
 * 동작 부여가 하나도 없으면 쓰기도 내보내기도 **보기와 같은 답**을 받는다.
 * 즉 이 축을 넣어도 아무것도 안 바뀐다 — 바뀌는 것은 관리자가 차단을 적은 뒤부터다.
 * 기본을 「닫힘」으로 두면 배포하는 순간 쓰던 사람들이 전부 막힌다.
 */

import type { Grant, Viewer } from './decide.ts'

/** 동작 셋. 「보기」는 표면·자리 판정 그 자체라 따로 키를 갖지 않는다 */
export type AccessAction = 'view' | 'write' | 'export'

export const ACCESS_ACTIONS: readonly AccessAction[] = ['view', 'write', 'export']

/**
 * 동작을 붙이는 글자. 자리 구분자(`:`)와 달라야 `crm:quotes#export` 를 되돌려 가를 수 있다.
 * 주소에도 표면 키에도 안 쓰는 글자를 골랐다.
 */
const ACTION_SEP = '#'

/** `crm` + `export` → `crm#export`. 「보기」는 키를 안 붙인다 — 그것이 표면 판정 자체다 */
export function actionKey(baseKey: string, action: AccessAction): string {
  return action === 'view' ? baseKey : `${baseKey}${ACTION_SEP}${action}`
}

/** `crm:quotes#export` → 바탕 `crm:quotes` 와 동작 `export`. 동작이 없으면 `null` */
export function splitAction(key: string): { base: string; action: AccessAction | null } {
  const at = key.indexOf(ACTION_SEP)
  if (at < 0) return { base: key, action: null }
  const tail = key.slice(at + 1)
  const action = (ACCESS_ACTIONS as readonly string[]).includes(tail) ? (tail as AccessAction) : null
  // 모르는 동작은 바탕 키로 접지 않는다 — 접으면 오타 하나가 조용히 「보기」로 읽힌다
  return action ? { base: key.slice(0, at), action } : { base: key, action: null }
}

/**
 * 이 동작이 **막혀 있나** — 동작 축은 거부권이지 허가권이 아니다.
 *
 * ## 왜 거부권인가
 *
 * 「들어갈 수 있나」는 이미 다른 것이 답했다. 표면·자리는 `decide.ts` 가, CRM·CI 안쪽은
 * 그 서비스 셸이 답한다. 동작 축이 그 답을 **다시** 하면 두 답이 갈린다.
 * 실제로 갈릴 뻔했다 — `crm` 표면의 기본값은 관리자인데 CRM 셸은 멤버면 들여보낸다.
 * 동작을 표면 기본값에서 물려받게 두면, 아무도 차단을 안 적었는데 일반 사용자 CRM 멤버가
 * 내보내기에서 막힌다. **부여가 0건이면 지금과 같아야 한다**가 그 자리에서 깨진다.
 *
 * 그래서 여기서는 **적힌 것만** 본다. 아무 말도 없으면 안 막힌다.
 *
 * ## 좁은 것이 이긴다
 *
 *   crm:quotes 의 export → ① crm:quotes#export  그 자리의 그 동작
 *                          ② crm#export         표면 전체의 그 동작
 *
 * ①에 허용이 적혀 있으면 ②의 금지를 이긴다 — 「내보내기는 원칙 금지, 견적만 예외」가
 * 그 모양이다. 자리에 아무 말이 없으면 표면의 말이 내려온다.
 *
 * 관리자는 부르는 쪽에서 이미 통과한다(`decide.ts` 1번). 여기서 또 보지 않는다 —
 * 같은 규칙이 두 곳에 있으면 한 곳만 고쳐지는 날이 온다.
 */
export function actionChain(action: AccessAction, bases: readonly string[]): string[] {
  return action === 'view' ? [] : bases.map((b) => actionKey(b, action))
}

/**
 * 적힌 말대로 답한다 — `true` 되고, `false` 막히고, 아무 말도 없으면 안 막힌다.
 *
 * 순수 함수로 둔 이유: 여기가 «내보내기가 되나»의 전부인데, 서버 모듈 안에 있으면
 * 시험이 닿지 않는다. `load.ts` 와 `load-pure.ts` 를 가른 것과 같은 이유다.
 */
export function vetoesAction(
  action: AccessAction,
  bases: readonly string[],
  viewer: Viewer,
  grants: readonly Grant[],
): boolean {
  for (const key of actionChain(action, bases)) {
    const mine = grants.filter((g) => g.surfaceKey === key && appliesTo(g, viewer))
    if (mine.length === 0) continue
    // 차단이 허용을 이긴다 — 판정 2번과 같은 순서다
    return mine.some((g) => g.effect === 'deny')
  }
  return false
}

function appliesTo(grant: Grant, viewer: Viewer): boolean {
  return grant.subject.kind === 'user'
    ? grant.subject.id === viewer.userId
    : viewer.orgIds.includes(grant.subject.id)
}

/** 사람이 고르는 묶음 — 동작을 하나씩 고르게 하면 조합을 외워야 한다 */
export type AccessPreset = 'viewOnly' | 'write' | 'exportToo'

/**
 * 프리셋 하나가 어떤 동작을 **차단**하는가.
 *
 * 프리셋은 허용이 아니라 **차단의 묶음**이다. 허용으로 만들면 표면을 안 열어 준 사람에게
 * 「쓰기 허용」을 주는 앞뒤 안 맞는 부여가 생긴다 — 문을 안 열고 안에서 할 일을 정하는 꼴이다.
 */
export const PRESET_DENIES: Record<AccessPreset, readonly AccessAction[]> = {
  /** 보기만. 쓰기도 내보내기도 막는다 */
  viewOnly: ['write', 'export'],
  /** 쓰기까지. 내보내기만 막는다 */
  write: ['export'],
  /** 내보내기까지. 아무것도 안 막는다 — 표면 판정 그대로다 */
  exportToo: [],
}
