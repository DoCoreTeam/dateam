/**
 * 나눠 읽기 — **PostgREST 는 한 번에 1,000줄까지만 돌려준다**
 *
 * 실측 2026-11-09: 봉 3,000개를 달라고 했는데 1,000개(약 2.5거래일)가 왔다.
 * 오류도 경고도 없이 잘려서, 성적 칸이 몇 주 동안 최근 며칠만 채점하고 있었다.
 * `limit` 이 그 상한을 넘으면 `range` 로 나눠 읽는다.
 */

export const POSTGREST_MAX_ROWS = 1_000

/** [from, to] 묶음들. to 는 포함이다 (PostgREST range 와 같다) */
export function pageRanges(limit: number, pageSize = POSTGREST_MAX_ROWS): [number, number][] {
  const out: [number, number][] = []
  for (let from = 0; from < limit; from += pageSize) {
    out.push([from, Math.min(from + pageSize, limit) - 1])
  }
  return out
}
