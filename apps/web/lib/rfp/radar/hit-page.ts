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

/**
 * 한 공고를 한 줄로 묶는다
 *
 * ## 왜 필요한가
 *
 * 적중은 **규칙마다 하나씩** 생긴다(`unique (rule_id, source_id)`). 그래서 같은 공고가
 * 두 규칙에 걸리면 목록에 두 번 뜬다. 실측 2026-10-02: 적중 135건이 공고 128건을 가리키고
 * 7건이 두세 번 떴다. 사용자가 보기에는 같은 공고가 반복되는 것이고, 하나를 숨겨도
 * 나머지가 남아 **숨긴 것이 다시 나타난다.**
 *
 * ## 왜 쪽을 나누기 전에 묶나
 *
 * 묶기 전에 자르면 한 공고의 적중이 쪽 경계에 걸쳐 두 쪽에 나뉘고, 그러면 묶어도 소용이 없다.
 * 그래서 **먼저 묶고 그다음 자른다.**
 */

/** 묶기 전에 읽어 올 최대 적중 수. 이보다 많으면 오래된 것부터 안 보인다 */
export const MAX_SCAN = 2000

export interface RawHit {
  id: string
  source_id: string
  rule_id: string
  pre_score: number | null
  reason: string | null
  case_id: string | null
  status: string
  created_at: string
}

export interface GroupedHit {
  /** 화면이 쓰는 id. 묶음의 대표다 */
  id: string
  /** 이 공고의 적중 **전부**. 숨길 때 이 목록을 통째로 넘긴다 */
  ids: string[]
  source_id: string
  case_id: string | null
  status: string
  created_at: string
  /** 가장 높은 점수 */
  pre_score: number | null
  /** 걸린 규칙들 — 합치면서 왜 걸렸는지를 잃지 않는다 */
  rule_ids: string[]
  /** 걸린 사유들. 같은 말은 한 번만 */
  reason: string | null
}

export function groupHits(rows: readonly RawHit[]): GroupedHit[] {
  const by = new Map<string, GroupedHit>()

  for (const r of rows) {
    const prev = by.get(r.source_id)
    if (!prev) {
      by.set(r.source_id, {
        id: r.id, ids: [r.id], source_id: r.source_id, case_id: r.case_id,
        status: r.status, created_at: r.created_at, pre_score: r.pre_score,
        rule_ids: [r.rule_id], reason: r.reason,
      })
      continue
    }
    prev.ids.push(r.id)
    if (!prev.rule_ids.includes(r.rule_id)) prev.rule_ids.push(r.rule_id)
    // 점수는 가장 높은 것을 쓴다 — 낮은 쪽으로 접으면 걸릴 만한 공고가 아래로 내려간다
    if ((r.pre_score ?? 0) > (prev.pre_score ?? 0)) {
      prev.pre_score = r.pre_score
      prev.id = r.id
    }
    if (r.reason && prev.reason && !prev.reason.includes(r.reason)) {
      prev.reason = `${prev.reason} · ${r.reason}`
    } else if (r.reason && !prev.reason) {
      prev.reason = r.reason
    }
  }

  return [...by.values()].sort(
    (a, b) => (b.pre_score ?? 0) - (a.pre_score ?? 0) || a.source_id.localeCompare(b.source_id),
  )
}

/** 묶은 뒤 한 쪽을 자른다 */
export function slicePage<T>(rows: readonly T[], page: PageInput): T[] {
  return rows.slice(page.offset, page.offset + page.limit)
}

/**
 * 좁혀 보기 — 검색과 정렬
 *
 * 129건을 눈으로만 훑는 것은 쓸 수 있는 방법이 아니다.
 *
 * ## 검색어는 밖에서 온 값이다
 *
 * 거르기를 **SQL 이 아니라 여기서** 한다. `like` 로 넘기면 `%` 와 `_` 가 아무 글자를 뜻해
 * 「%」 한 글자가 모든 공고에 걸리고, 사용자는 거르려다 오히려 전부를 받는다.
 * `includes` 에는 그 뜻이 없어 넘어온 글자를 글자 그대로 찾는다 —
 * **이스케이프할 것이 없는 쪽을 고른 것**이지 빠뜨린 것이 아니다.
 * (실측 2026-10-02: q=% 는 0건, q=_ 는 밑줄이 실제로 든 2건)
 *
 * 길이는 자른다. 질의를 길게 만들어 봐야 찾는 것은 같다.
 */

/** 검색어 길이 상한. 더 길면 자른다 — 질의를 길게 만들어 봐야 찾는 것은 같다 */
export const MAX_QUERY = 100

export type SortKey = 'score' | 'noticeDate'

export const SORT_KEYS: readonly SortKey[] = ['score', 'noticeDate']

export function sortKeyOf(raw: unknown): SortKey {
  return typeof raw === 'string' && (SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as SortKey)
    : 'score'
}

/** 찾을 글자를 다듬는다. 빈 글자면 null — 안 거른다는 뜻이다 */
export function queryOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const q = raw.trim().slice(0, MAX_QUERY)
  return q.length > 0 ? q : null
}

export interface NoticeLike {
  title: string | null
  agency: string | null
  noticeDate: string | null
}

/** 제목이나 발주처에 그 글자가 들어 있나. 대소문자는 안 가린다 */
export function matchesQuery(n: NoticeLike | null | undefined, q: string): boolean {
  if (!n) return false
  const needle = q.toLowerCase()
  return (n.title ?? '').toLowerCase().includes(needle)
    || (n.agency ?? '').toLowerCase().includes(needle)
}

/** 고른 기준으로 줄을 세운다 */
export function sortRows<T extends { pre_score: number | null; notice?: NoticeLike | null }>(
  rows: readonly T[], key: SortKey,
): T[] {
  const out = [...rows]
  if (key === 'noticeDate') {
    // 날짜가 없는 것은 뒤로 — 앞에 두면 모르는 것이 가장 최근인 것처럼 보인다
    return out.sort((a, b) => (b.notice?.noticeDate ?? '').localeCompare(a.notice?.noticeDate ?? ''))
  }
  return out.sort((a, b) => (b.pre_score ?? 0) - (a.pre_score ?? 0))
}
