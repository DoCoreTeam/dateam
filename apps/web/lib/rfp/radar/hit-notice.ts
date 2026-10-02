/**
 * 적중에 공고 정보를 붙인다
 *
 * ## 왜 한자리에 두나
 *
 * 붙이는 코드가 **서버 첫 렌더에만** 있었다. 화면을 열면 제목이 보이는데, 훑기를 누르면
 * 클라이언트가 GET 으로 다시 받고 그 응답에는 공고 정보가 없어 **제목이 사라졌다.**
 * 사용자가 보기에는 「훑었더니 목록이 망가졌다」이고, 실제로는 두 경로가 다른 코드를 쓴 것이다.
 *
 * 그래서 붙이는 모양을 여기 하나만 둔다. 한쪽만 고쳐지는 일이 구조적으로 안 생긴다.
 *
 * ## 왜 임베드(!inner)를 안 쓰나
 *
 * `rfp_radar_hits.source_id` 에 외래키가 있지만, 원천이 지워진 적중을 임베드로 읽으면
 * 그 줄이 **통째로 사라진다.** 그건 「어제 본 공고가 없어짐」이다.
 * 그래서 두 번 읽고 없는 것은 없는 대로 둔다.
 */

import { noticeUrlOf } from './notice-url.ts'

export interface HitNotice {
  title: string | null
  agency: string | null
  budgetAmount: number | null
  noticeDate: string | null
  /** 발주처 사이트의 공고 원문. 없으면 null — 눌러도 갈 데가 없다는 뜻이다 */
  url: string | null
}

export interface HitLike {
  source_id: string
}

/** 공고 표에서 읽을 칸. 한 곳에 적어 두 경로가 같은 것을 읽게 한다 */
export const NOTICE_COLS = 'id, title, announcing_agency, budget_amount, notice_date, raw'

export interface NoticeDbClient {
  from(table: string): {
    select(cols: string): { in(key: string, values: string[]): Promise<{ data: unknown }> }
  }
}

const str = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === '' ? null : String(v)

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 공고 한 줄을 화면이 쓰는 모양으로 */
export function toNotice(row: Record<string, unknown>): HitNotice {
  return {
    title: str(row.title),
    agency: str(row.announcing_agency),
    budgetAmount: num(row.budget_amount),
    noticeDate: str(row.notice_date),
    // 원문 주소는 받아 온 응답 안에 들어 있다. 어느 칸에 들었는지는 noticeUrlOf 가 안다
    url: noticeUrlOf(row.raw),
  }
}

/**
 * 적중 목록에 공고 정보를 붙여 돌려준다.
 *
 * 못 읽어도 적중은 그대로 돌려준다 — 제목이 없는 목록이 목록이 없는 것보다 낫다.
 */
export async function attachNotices<T extends HitLike>(
  db: NoticeDbClient, hits: readonly T[],
): Promise<(T & { notice: HitNotice | null })[]> {
  const ids = Array.from(new Set(hits.map((h) => h.source_id).filter(Boolean)))
  if (ids.length === 0) return hits.map((h) => ({ ...h, notice: null }))

  let byId = new Map<string, HitNotice>()
  try {
    const { data } = await db.from('rfp_sources').select(NOTICE_COLS).in('id', ids)
    byId = new Map(((data as Record<string, unknown>[] | null) ?? []).map((r) => [String(r.id), toNotice(r)]))
  } catch {
    // 제목이 없는 목록이 목록이 없는 것보다 낫다
  }
  return hits.map((h) => ({ ...h, notice: byId.get(h.source_id) ?? null }))
}
