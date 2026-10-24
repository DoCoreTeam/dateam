/**
 * 목록 다음 쪽 커서 `<created_at>__<id>` 를 읽는다
 *
 * **왜**: 커서 두 조각을 그대로 PostgREST `.or()` 필터 글에 끼워 넣고 있었다.
 *   `,` 나 `)` 를 넣은 커서로 필터 조건을 덧붙일 수 있었고, 공개 API 는 서비스롤로 돌아 RLS 도 없다(감사 2026-10-23).
 *   우리가 만들어 준 모양(ISO 시각과 uuid)이 아니면 커서가 없는 것으로 친다.
 */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ListCursor {
  time: string
  id: string
}

export function parseListCursor(raw: string | null | undefined): ListCursor | null {
  if (!raw) return null
  // 주소에 그대로 넣은 + 는 공백으로 읽힌다, 시간대 앞 공백을 + 로 되돌린다
  const [time, id, ...rest] = raw.replace(/ (\d{2}:\d{2})(__|$)/, '+$1$2').split('__')
  if (rest.length > 0 || !time || !id) return null
  if (!ISO_TIME.test(time) || !UUID.test(id)) return null
  return { time, id }
}

/**
 * `.or()` 에 넣을 조건, 검증을 지난 값만 들어온다
 * column 은 코드가 정하는 상수다, 요청 값을 넣지 않는다
 */
export function cursorFilter({ time, id }: ListCursor, column = 'created_at'): string {
  return `${column}.lt.${time},and(${column}.eq.${time},id.lt.${id})`
}

/** 잘못된 커서에 돌려줄 말, 커서를 읽는 창구가 함께 쓴다 */
export const INVALID_CURSOR_MESSAGE = 'cursor 값이 올바르지 않습니다. 앞 응답의 nextCursor 를 그대로 넣어 주세요.'

export function encodeListCursor(time: string, id: string): string {
  return `${time}__${id}`
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * limit+1 줄을 받아 한 쪽과 다음 커서를 만든다
 * 줄은 (시각 내림, id 내림) 으로 정렬돼 와야 한다, 그래야 cursorFilter 와 맞물려 겹침이 없다
 */
export function pageByCursor<T>(rows: T[], limit: number, timeOf: (row: T) => string, idOf: (row: T) => string): CursorPage<T> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  const nextCursor = hasMore && last ? encodeListCursor(timeOf(last), idOf(last)) : null
  return { items, nextCursor, hasMore }
}
