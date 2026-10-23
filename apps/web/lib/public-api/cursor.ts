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
  const [time, id, ...rest] = raw.split('__')
  if (rest.length > 0 || !time || !id) return null
  if (!ISO_TIME.test(time) || !UUID.test(id)) return null
  return { time, id }
}

/** `.or()` 에 넣을 조건 — 검증을 지난 값만 들어온다 */
export function cursorFilter({ time, id }: ListCursor): string {
  return `created_at.lt.${time},and(created_at.eq.${time},id.lt.${id})`
}
