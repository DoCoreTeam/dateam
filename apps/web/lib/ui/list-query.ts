// lib/ui/list-query.ts — 목록 화면의 상태 계약 SSOT
//
// 왜: 목록 화면 40여 개가 검색·정렬·보기·페이지를 각자 `useState`로 들고 있었다.
//   그래서 새로고침하면 날아가고, 링크로 공유하면 남이 다른 화면을 봤다.
//   **URL이 진실**이다 — 공유·새로고침·뒤로가기가 공짜로 성립한다.
//
// 우선순위: URL > 저장된 개인 설정 > 화면 기본값.
//   (공유 링크가 남의 저장 설정에 덮이면 안 된다.)
// 저장 범위는 view·size·sort뿐 — **필터는 저장하지 않는다.**
//   다음 방문에 조건이 살아 있으면 "왜 데이터가 없지?"가 된다.

export type ListView = 'table' | 'card' | 'compact'
export type ListSize = 20 | 50 | 100
export type ListMode = 'pages' | 'more'

export interface ListSort {
  key: string
  dir: 'asc' | 'desc'
}

export interface ListQuery {
  /** 검색어 */
  q: string
  sort: ListSort
  /** 화면이 선언한 키만 담긴다(URL 오염 차단) */
  filters: Record<string, string>
  view: ListView
  size: ListSize
  mode: ListMode
  /** 1-based. mode='more'면 누적 페이지 수로 읽는다 */
  page: number
}

export interface ListDefaults {
  sort: ListSort
  view?: ListView
  size?: ListSize
  mode?: ListMode
  /** 이 화면이 쓰는 필터 키 화이트리스트 */
  filterKeys?: readonly string[]
}

/** 서버에 저장하는 개인 설정 — 화면 기본값을 개인이 덮는 용도 */
export interface SavedListPrefs {
  view?: ListView
  size?: ListSize
  sort?: ListSort
}

export const LIST_SIZES: readonly ListSize[] = [20, 50, 100]
export const LIST_VIEWS: readonly ListView[] = ['table', 'card', 'compact']

/** 상한 100 — 무한 렌더 방지(성능 규약) */
export function clampSize(raw: unknown): ListSize | undefined {
  const n = typeof raw === 'string' ? Number(raw) : raw
  return LIST_SIZES.find((s) => s === n)
}

function asView(raw: unknown): ListView | undefined {
  return LIST_VIEWS.find((v) => v === raw)
}

function asDir(raw: unknown): 'asc' | 'desc' | undefined {
  return raw === 'asc' || raw === 'desc' ? raw : undefined
}

type ParamsLike = URLSearchParams | Record<string, string | undefined>

function get(params: ParamsLike, key: string): string | undefined {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key]
  return v == null || v === '' ? undefined : v
}

/**
 * URL·저장설정·기본값을 한 번에 접어 화면이 읽을 값 하나를 만든다.
 * 화면은 이 결과만 읽는다 — 우선순위를 화면마다 다시 구현하지 않는다.
 */
export function resolveListQuery(
  params: ParamsLike,
  defaults: ListDefaults,
  saved?: SavedListPrefs | null,
): ListQuery {
  const sortKey = get(params, 'sort') ?? saved?.sort?.key ?? defaults.sort.key
  const sortDir = asDir(get(params, 'dir')) ?? saved?.sort?.dir ?? defaults.sort.dir

  const filters: Record<string, string> = {}
  for (const key of defaults.filterKeys ?? []) {
    const v = get(params, key)
    if (v !== undefined) filters[key] = v
  }

  const pageRaw = Number(get(params, 'page') ?? '1')
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1

  return {
    q: get(params, 'q') ?? '',
    sort: { key: sortKey, dir: sortDir },
    filters,
    view: asView(get(params, 'view')) ?? saved?.view ?? defaults.view ?? 'table',
    size: clampSize(get(params, 'size')) ?? saved?.size ?? defaults.size ?? 20,
    mode: defaults.mode ?? 'pages',
    page,
  }
}

/**
 * 기본값과 같은 값은 URL에 쓰지 않는다 — 주소가 길어지면 공유가 꺼려진다.
 * 저장 설정과 같아도 **URL에는 남긴다**: 링크를 받은 사람에게는 그게 유일한 단서다.
 */
/** 목록이 소유하는 URL 키 — 이 밖의 파라미터는 목록이 건드리지 않는다. */
export function ownedParamKeys(defaults: ListDefaults): Set<string> {
  return new Set<string>(['q', 'sort', 'dir', 'view', 'size', 'page', ...(defaults.filterKeys ?? [])])
}

/**
 * @param preserveFrom 현재 주소. 목록이 소유하지 않은 파라미터(`tab` 등)를 그대로 옮긴다.
 *   주지 않으면 목록 파라미터만 남는다 — 예전 동작이며, 화면의 다른 상태를 지워
 *   "필터를 건드리면 엉뚱한 탭으로 튕기는" 사고를 냈다.
 */
export function listQueryToParams(
  query: ListQuery,
  defaults: ListDefaults,
  preserveFrom?: URLSearchParams,
): URLSearchParams {
  const p = new URLSearchParams()
  if (query.q) p.set('q', query.q)
  if (query.sort.key !== defaults.sort.key) p.set('sort', query.sort.key)
  if (query.sort.dir !== defaults.sort.dir) p.set('dir', query.sort.dir)
  for (const [k, v] of Object.entries(query.filters)) if (v) p.set(k, v)
  if (query.view !== (defaults.view ?? 'table')) p.set('view', query.view)
  if (query.size !== (defaults.size ?? 20)) p.set('size', String(query.size))
  if (query.page > 1) p.set('page', String(query.page))
  if (preserveFrom) {
    const owned = ownedParamKeys(defaults)
    // forEach — URLSearchParams 이터레이터는 tsconfig target에서 for..of가 막힌다
    preserveFrom.forEach((v, k) => { if (!owned.has(k)) p.set(k, v) })
  }
  return p
}

/** 저장 대상만 남긴다(필터·검색어·페이지는 저장하지 않는다) */
export function savedFromQuery(query: ListQuery): SavedListPrefs {
  return { view: query.view, size: query.size, sort: query.sort }
}

/** 신뢰할 수 없는 저장값(옛 스키마·손상)을 화면에 들이지 않는다 */
export function sanitizeSavedPrefs(raw: unknown): SavedListPrefs {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const out: SavedListPrefs = {}
  const view = asView(o.view)
  if (view) out.view = view
  const size = clampSize(o.size)
  if (size) out.size = size
  const sort = o.sort as Record<string, unknown> | undefined
  const dir = asDir(sort?.dir)
  if (sort && typeof sort.key === 'string' && sort.key && dir) out.sort = { key: sort.key, dir }
  return out
}

/** 조건이 바뀌면 1페이지로 — 3페이지를 보던 채로 검색하면 빈 화면이 나온다 */
export function shouldResetPage(patch: Partial<ListQuery>): boolean {
  return ['q', 'sort', 'filters', 'size'].some((k) => k in patch)
}

/** Supabase .range()에 그대로 넣는 경계 */
export function rangeOf(query: ListQuery): { from: number; to: number } {
  // more 모드는 지금까지 본 것을 다 보여준다 — 스크롤 위치를 잃지 않기 위해서다
  const rows = query.mode === 'more' ? query.size * query.page : query.size
  const from = query.mode === 'more' ? 0 : (query.page - 1) * query.size
  return { from, to: from + rows - 1 }
}

export function pageCount(total: number, size: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1
  return Math.max(1, Math.ceil(total / size))
}

/** 페이지 버튼 창 — 100페이지를 다 그리지 않는다 */
export function pageWindow(page: number, count: number, span = 5): number[] {
  const half = Math.floor(span / 2)
  let start = Math.max(1, page - half)
  const end = Math.min(count, start + span - 1)
  start = Math.max(1, end - span + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}
