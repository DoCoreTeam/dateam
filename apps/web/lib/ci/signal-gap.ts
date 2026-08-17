// lib/ci/signal-gap.ts — "판단 근거가 없는 게시물"의 정의 SSOT
//
// **왜 한곳에 두는가**: 세는 조건과 훑는 조건이 갈렸다.
//   카드가 보여 주는 숫자(GET)는 플랫폼을 보지 않았고, 버튼이 실제로 훑는 대상(POST)은
//   youtube만 봤다. 그래서 유튜브가 아닌 게시물은 **세어지지만 절대 채워지지 않았다.**
//   같은 카드 안에 「게시물 1건은 플랫폼 신호 없이 담겼습니다」와
//   「다시 받아올 게시물이 이미 하나도 남지 않았어요」가 **동시에** 떴고,
//   눌러도 화면이 영원히 그대로였다(실측 /ci/inbox v0.7.559 · G3 판정 #112 원인 1).
//
// 규칙: **세는 곳과 하는 곳은 같은 함수를 부른다.** 조건이 바뀌면 여기만 바뀐다.
// 화면이 "할 수 있다"고 세고 서버가 "할 수 없다"고 답하는 상태를 구조로 막는다.

/**
 * 신호를 다시 받아올 수 있는 플랫폼 — **커넥터가 있는 곳만.**
 * 늘어나면 여기만 고친다(라우트가 각자 문자열을 적지 않는다).
 */
export const REFILLABLE_PLATFORMS = ['youtube'] as const

/**
 * supabase 쿼리 빌더 중 이 모듈이 쓰는 부분만.
 * 클라이언트 타입에 묶지 않는다 — count 쿼리와 select 쿼리가 같은 조건을 쓰게 하는 것이 목적이다.
 */
export interface SignalGapFilter {
  eq(column: string, value: unknown): SignalGapFilter
  is(column: string, value: unknown): SignalGapFilter
  in(column: string, values: readonly unknown[]): SignalGapFilter
}

/**
 * 신호가 비어 있는 게시물 — 플랫폼 카테고리도, 주제 신호도 없는 것.
 * 이것이 "판단 근거가 없다"의 정의다.
 */
export function whereMissingSignals<T extends SignalGapFilter>(q: T): T {
  return q.eq('topic_signals', '{}').is('platform_category', null) as T
}

/**
 * 그중 **실제로 다시 받아올 수 있는** 것.
 *
 * 반드시 `whereMissingSignals`를 포함한다 — 세는 조건의 부분집합이어야
 * "센 것을 다 채울 수 있다"가 성립한다. 포함하지 않으면 다시 갈린다.
 */
export function whereRefillable<T extends SignalGapFilter>(q: T): T {
  return whereMissingSignals(q).in('platform', REFILLABLE_PLATFORMS) as T
}
