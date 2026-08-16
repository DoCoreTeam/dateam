/**
 * 커서 목록 (TASKS T1-02 "목록(커서)")
 *
 * 왜 offset 이 아니라 커서인가:
 *   offset 은 목록이 움직이면 어긋난다. 2페이지를 보는 사이 누가 회사를 하나 만들면
 *   1페이지 마지막 항목이 2페이지 첫 항목으로 밀려 **같은 회사를 두 번 본다.**
 *   영업 목록은 늘 움직이므로 이 어긋남이 상시로 일어난다.
 *
 * 정렬 기준을 updatedAt 하나로 두지 않는 이유:
 *   같은 밀리초에 만들어진 두 행이 있으면 커서가 그 자리를 못 집는다.
 *   그래서 (updatedAt, id) 복합으로 자른다 — id 가 동점을 깬다.
 */

export interface CursorPage<T> {
  items: T[]
  /** 다음 페이지 커서. null 이면 끝이다 */
  nextCursor: string | null
}

export interface CursorInput {
  cursor?: string | null
  /** 한 번에 가져올 개수 (기본 20, 상한 100 — 호스트 목록 표준 §2-6과 같은 값) */
  limit?: number
}

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

export function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(limit), MAX_LIMIT)
}

/** 커서 = `${updatedAt ISO}|${id}`. 사람이 읽을 수 있게 두 값을 그대로 담는다 */
export function encodeCursor(row: { updatedAt: Date; id: string }): string {
  return `${row.updatedAt.toISOString()}|${row.id}`
}

export interface DecodedCursor {
  updatedAt: Date
  id: string
}

/** 깨진 커서는 조용히 무시한다(첫 페이지로 떨어진다) — 던지면 링크 하나로 화면이 죽는다 */
export function decodeCursor(cursor: string | null | undefined): DecodedCursor | null {
  if (!cursor) return null
  const sep = cursor.lastIndexOf('|')
  if (sep < 0) return null
  const at = new Date(cursor.slice(0, sep))
  const id = cursor.slice(sep + 1)
  if (Number.isNaN(at.getTime()) || !id) return null
  return { updatedAt: at, id }
}

/**
 * 최신순(updatedAt DESC, id DESC) 목록의 where 조건.
 * 커서보다 "더 오래된" 것만 가져온다 — 같은 시각이면 id 로 가른다.
 */
export function cursorWhere(decoded: DecodedCursor | null): Record<string, unknown> | undefined {
  if (!decoded) return undefined
  return {
    OR: [
      { updatedAt: { lt: decoded.updatedAt } },
      { updatedAt: decoded.updatedAt, id: { lt: decoded.id } },
    ],
  }
}

export const CURSOR_ORDER = [{ updatedAt: 'desc' as const }, { id: 'desc' as const }]

/**
 * limit + 1 개를 가져와 다음 페이지 유무를 판정한다.
 * "총 개수"를 세지 않는 이유: 매 요청마다 count 를 치면 목록이 커질수록 느려지고,
 * 사용자는 보통 총 개수보다 "다음이 있느냐"를 궁금해한다.
 */
export function toPage<T extends { updatedAt: Date; id: string }>(
  rows: T[],
  limit: number,
): CursorPage<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null }
  const items = rows.slice(0, limit)
  return { items, nextCursor: encodeCursor(items[items.length - 1]) }
}
