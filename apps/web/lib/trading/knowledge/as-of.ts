/**
 * 「그 시각에 알 수 있었나」 — **한 함수가 정한다**
 *
 * ## 왜 규율이 필요한가
 *
 * 오늘 쓴 지식 카드가 석 달 전 봉의 판단에 섞이면, 그 백테스트는 **미래를 보고 친 것**이다.
 * 성적은 좋게 나오고 실전에서는 재현되지 않는다. 그리고 화면에서는 똑같이 보인다 —
 * 「기대값 0.3R」 옆에 「이 값은 미래를 봤습니다」라고 안 적힌다.
 *
 * 읽는 자리마다 `.lte('available_at', asOf)` 를 기억해서 붙이는 방식은 반드시 한 곳을 빠뜨린다.
 * 그래서 조회를 만드는 함수를 하나 두고, 가드가 **직접 만든 조회가 0개**임을 센다.
 *
 * ## `available_at` 은 쓴 시각이다
 *
 * 사람이나 AI 가 정하는 값이 아니다. 그래서 **앱이 그 칸을 안 쓴다** — DB 기본값이 박는다.
 * 넘길 통로가 없으면 고를 수도 없다.
 */

/** 지식 표들. 이 목록이 곧 「as-of 규율이 걸리는 자리」다 */
export const KNOWLEDGE_TABLES = [
  'trading_knowledge_cards',
  'trading_source_analyses',
  'trading_pattern_reports',
  'trading_spec_candidates',
  'trading_signal_explanations',
  'trading_exit_judgments',
] as const
export type KnowledgeTable = (typeof KNOWLEDGE_TABLES)[number]

export interface AsOfRow {
  availableAt: Date
}

/**
 * 그 시각에 있었던 것만 남긴다.
 *
 * 경계는 **포함**이다. 봉이 확정된 그 순간에 쓴 카드는 그 봉의 판단에 쓸 수 있다 —
 * 같은 밀리초를 빼면 경계에 있는 자료가 이유 없이 사라지고, 그 손실은 아무 데도 안 적힌다.
 */
export function visibleAsOf<T extends AsOfRow>(rows: readonly T[], asOf: Date): T[] {
  return rows.filter((r) => r.availableAt.getTime() <= asOf.getTime())
}

/** 미래에 쓴 것 수. 0 이 아니면 그 조회는 as-of 를 안 지켰다 */
export function futureCount<T extends AsOfRow>(rows: readonly T[], asOf: Date): number {
  return rows.length - visibleAsOf(rows, asOf).length
}

/**
 * Supabase 질의에 as-of 를 건다.
 *
 * 부르는 쪽이 `.lte('available_at', ...)` 를 직접 쓰지 않는다 — 직접 쓰면 한 곳을 빠뜨리고,
 * 빠뜨린 자리는 조용히 미래를 본다. 가드가 「직접 쓴 자리 0개」를 센다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyAsOf<Q extends { lte: (column: string, value: string) => Q }>(
  query: Q, asOf: Date,
): Q {
  return query.lte('available_at', asOf.toISOString())
}

/**
 * ## 넣을 때는 `available_at` 을 **안 적는다**
 *
 * 쓰는 함수를 두지 않았다. DB 기본값 `now()` 가 쓴 시각을 박고, 앱에는 그 값을 넘길
 * 통로 자체가 없다 — 통로가 있으면 언젠가 「이 카드는 그때도 알았던 것으로 해 두자」가
 * 생기고, 그 한 줄이 백테스트 전체를 못 믿게 만든다.
 * 아래 `as-of.test.ts` 가 지식 표 insert 에 `available_at` 이 0건임을 센다.
 */

/**
 * 지금 알 수 있는 것만 골라 프롬프트에 넣을 자료로 만든다.
 *
 * AI 에게 넘기는 자료도 같은 규율을 지킨다 — 오늘 자료로 과거를 설명하면 그 설명은
 * 「그때 이렇게 보였다」가 아니라 「지금 돌아보니 이렇다」이고, 둘은 다른 글이다.
 */
export function asOfContext<T extends AsOfRow>(
  rows: readonly T[], asOf: Date, limit: number,
): { used: T[]; skippedFuture: number } {
  const visible = visibleAsOf(rows, asOf)
  return {
    used: visible.slice(0, Math.max(0, limit)),
    skippedFuture: rows.length - visible.length,
  }
}
