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
  /**
   * 조건에 걸린 **총 건수**. 첫 페이지에서만 채워진다(이어 볼 때는 undefined).
   *
   * 예전엔 아예 세지 않았다 — "사용자는 총 개수보다 다음이 있느냐를 궁금해한다"는 이유였다.
   * 실데이터 380건을 옮기고 나니 그 판단이 틀렸다는 게 화면에서 바로 드러났다:
   * 회사 목록이 20건씩 '더 보기'만 반복하고, **몇 개가 들어왔는지 어디에도 없었다.**
   * 영업에서 총 건수는 부가 정보가 아니라 규모 그 자체이고,
   * 끝이 안 보이는 목록은 사람이 끝낼 수 없다(인박스 큐에서 겪은 것과 같은 문제).
   *
   * 비용은 **첫 페이지 1회**로 묶는다. '더 보기'는 커서만 이어받으므로 다시 세지 않는다.
   */
  total?: number
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
 * `total` 은 첫 페이지에서만 넘어온다 — 매 요청마다 count 를 치면 목록이 커질수록 느려진다.
 */
export function toPage<T extends { updatedAt: Date; id: string }>(
  rows: T[],
  limit: number,
  total?: number,
): CursorPage<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null, total }
  const items = rows.slice(0, limit)
  return { items, nextCursor: encodeCursor(items[items.length - 1]), total }
}

/**
 * 첫 페이지일 때만 총 건수를 센다. 이어 볼 때는 세지 않는다(같은 조건이라 값도 같다).
 *
 * `delegate` 는 Prisma 모델 델리게이트(`db.crmCompany` 등). 목록마다 count 를 손으로
 * 복붙하면 어떤 목록은 세고 어떤 목록은 안 세는 상태가 되므로 여기 한 곳에 둔다.
 */
export async function countIfFirstPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: { count: (args: any) => Promise<number> },
  where: Record<string, unknown>,
  decoded: DecodedCursor | null,
): Promise<number | undefined> {
  if (decoded) return undefined
  return delegate.count({ where })
}
