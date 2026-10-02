/**
 * 적중 목록 쪽 나누기
 *
 * ## 왜 필요한가
 *
 * 목록이 `limit(50)` 하나로 잘려 있었다. 실측 2026-10-01: 적중 80건인데 화면은 50건,
 * **나머지 30건은 어디에서도 볼 수 없었다.** 더보기가 없는 것이 아니라 데이터가 잘린 것이다.
 *
 * 배지도 가져온 수를 세고 있어 「50」이라고 떴다 — 숫자가 거짓말을 하고 있었다.
 * 그래서 **실제 건수는 따로 센다.**
 *
 * ## 밖에서 온 값이다
 *
 * 쪽 번호와 크기는 주소창으로 들어온다. 숫자로 강제하고 상한을 넘기면 상한으로 접는다.
 * 안 접으면 한 요청이 수천 건을 읽으려 들고 그 요청은 죽는다.
 */

/** 한 쪽에 받는 수. 화면이 한 번에 읽기 좋은 양이다 */
export const PAGE_SIZE = 50

/** 아무리 크게 달라고 해도 이만큼까지만 */
export const MAX_PAGE_SIZE = 200

export interface PageInput {
  /** 0부터 */
  offset: number
  limit: number
}

/** 밖에서 온 값을 쓸 수 있는 범위로 접는다 */
export function pageOf(rawOffset: unknown, rawLimit: unknown): PageInput {
  return {
    offset: clamp(rawOffset, 0, 0, Number.MAX_SAFE_INTEGER),
    limit: clamp(rawLimit, PAGE_SIZE, 1, MAX_PAGE_SIZE),
  }
}

function clamp(raw: unknown, fallback: number, min: number, max: number): number {
  /*
    **안 준 것과 0 을 가른다.** `Number(null)` 은 0 이라 그냥 넘기면 「안 줬다」가
    「0 을 줬다」가 되고, 한 쪽에 1건씩 받는 목록이 된다(실제로 그렇게 났다).
  */
  if (raw === null || raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** 이 쪽이 끝인가 — 받은 수가 달라고 한 수보다 적으면 끝이다 */
export function isLastPage(got: number, limit: number): boolean {
  return got < limit
}

/**
 * 더 받을 것이 남았나.
 *
 * 전체 건수를 알면 그걸로 판단한다. 모르면 받은 수로 판단한다 —
 * 세는 데 실패했다고 더보기를 없애면 남은 것을 영영 못 본다.
 */
export function hasMore(loaded: number, total: number | null, lastGot: number, limit: number): boolean {
  if (total !== null) return loaded < total
  return !isLastPage(lastGot, limit)
}
