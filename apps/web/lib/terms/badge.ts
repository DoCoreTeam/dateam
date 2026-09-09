/**
 * 배지의 말 — 숫자 하나가 **무엇을 세는지** 밝히는 자리 (용어집 §0-2)
 *
 * **왜 필요한가**(사용자 지적 2026-09-09): 사이드바 「업무」에 빨간 `1` 이 떠 있어서 눌렀는데
 * 일일업무 화면이 열렸고, 그 화면 어디에도 그 1건이 없었다 — **무엇이 1건인지 알 방법이 없었다.**
 * 실제로 그 숫자는 「내가 맡은 미완료 부서 업무」였고, 도착지(일일업무)와 뜻이 달랐다.
 *
 * 배지는 **열어 보지 않고 판단하라**고 있는 장치다. 뜻을 물어야 알 수 있으면 존재 이유가
 * 사라지고, 결국 열어 봐야 하니 없느니만 못하다.
 *
 * ## 규칙 넷
 *
 * 1. 뜻은 **한 문장으로 고정**한다. 조건에 따라 다른 값으로 바꾸지 않는다
 *    (`overdue > 0 ? overdue : total` 같은 코드가 실제로 있었다 — 어떤 날은 「밀린 것」,
 *     어떤 날은 「전부」였고 사용자는 그 규칙을 알 방법이 없었다).
 * 2. 셀 것이 0이면 배지를 **없앤다.** 0을 다른 숫자로 채우지 않는다.
 * 3. 뜻을 **사용자가 볼 수 있는 자리**에 남긴다 — 코드 주석이 아니라 `title`·`aria-label`.
 * 4. 숫자를 보여 줬으면 **그 숫자에 닿는 길**이 있어야 한다. 배지가 있는 화면으로 가면
 *    같은 뜻의 숫자가 그 다음 자리(탭·필터)에서 이어져야 한다.
 *
 * 조수사는 화면이 고르지 않는다 — 여기 표가 정한다(`lib/terms/entity.ts` 와 같은 원칙).
 */

import type { Counter } from './entity.ts'

export interface BadgeMeta {
  /** 이 숫자가 세는 것 — 사용자가 읽을 한 문장 */
  meaning: string
  counter: Counter
}

export type BadgeKey =
  | 'myOpenDeptTask' | 'todayEvent' | 'routinePending'
  | 'crmPendingSuggestion'
  | 'ciReview' | 'ciOutlier' | 'ciProducing' | 'ciReady'

export const BADGE: Record<BadgeKey, BadgeMeta> = {
  /** 「업무」 배지의 뜻. 담당이 나이고 아직 안 끝난 부서 업무만 센다(완료·삭제 제외) */
  myOpenDeptTask: { meaning: '내가 맡은 미완료 부서 업무', counter: '건' },
  todayEvent: { meaning: '오늘 하기로 한 일정', counter: '건' },
  routinePending: { meaning: '이번 주 아직 못 한 점검', counter: '건' },
  crmPendingSuggestion: { meaning: '확인을 기다리는 AI 제안', counter: '건' },
  ciReview: { meaning: '검토를 기다리는 게시물', counter: '건' },
  ciOutlier: { meaning: '새로 뜬 급상승 게시물', counter: '건' },
  ciProducing: { meaning: '만드는 중인 기획', counter: '건' },
  ciReady: { meaning: '내보낼 준비가 된 게시물', counter: '건' },
}

/**
 * 배지 옆에 붙일 설명 — `내가 맡은 미완료 부서 업무 1건`.
 *
 * 화면은 이 문장을 `title`·`aria-label` 에 그대로 넣는다. 문장을 화면에서 짓지 않는다.
 */
export function badgeTitle(key: BadgeKey, n: number): string {
  const b = BADGE[key]
  return `${b.meaning} ${n}${b.counter}`
}
