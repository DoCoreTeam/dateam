/**
 * 나라장터에서 공고를 모아 `rfp_sources` 를 채운다
 *
 * ## 왜 필요했나
 *
 * 레이더는 `rfp_sources` 를 훑는데 **아무도 그 표를 안 채웠다.** 조건을 만들어도
 * 훑을 대상이 0건이라 결과가 늘 비었다 — 「레이더가 안 된다」의 정체가 이것이다.
 *
 * ## 같은 공고를 두 번 안 담는다
 *
 * `(org, source_system, notice_no, notice_round)` 유니크가 최종 방어다.
 * 그래도 미리 걸러 보내는 이유는, 100건을 매번 다시 넣으면 실패 로그가 100줄씩 쌓여서다.
 */

import { searchNotices, inquiryRange, readServiceKey, lookbackDaysSince, type G2bResult } from '../g2b/client.ts'
import { toSourceRow, toDbColumns } from '../g2b/map.ts'

export interface CollectDb {
  from(table: string): any
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

export interface CollectInput {
  orgId: string
  lookbackDays?: number
  /** 쪽을 몇 장까지 넘길까. 크게 잡으면 한 번의 훑기가 몇 분이 된다 */
  maxPages?: number
  now?: () => number
  fetchImpl?: typeof fetch
}

export interface CollectResult {
  fetched: number
  inserted: number
  skipped: number
  /** 못 가져온 이유 — 화면이 그대로 보여 준다 */
  reason: string | null
  guide: string | null
}

export const MAX_PAGES = 3

/**
 * 공고를 모은다.
 *
 * 서비스 키가 없으면 **실패가 아니라 안내**다 — 키를 안 넣은 것은 고장이 아니고,
 * 오류로 처리하면 크론 로그가 빨갛게 차서 진짜 고장을 못 본다.
 */
export async function collectNotices(db: CollectDb, input: CollectInput): Promise<CollectResult> {
  const empty: CollectResult = { fetched: 0, inserted: 0, skipped: 0, reason: null, guide: null }

  const serviceKey = await readServiceKey(db as never)
  if (!serviceKey) {
    return { ...empty, reason: 'no_service_key', guide: '관리자 설정에 나라장터 서비스 키를 넣어 주세요' }
  }

  // 폭을 **마지막으로 성공한 때부터** 센다. 고정 2일이면 크론이 사흘 멈췄을 때
  // 가운데 하루가 영영 안 들어오고, 화면은 「새 공고 0건」으로 평소와 똑같이 보인다
  const nowMs = (input.now ?? Date.now)()
  const lookback = input.lookbackDays ?? lookbackDaysSince(await lastCollectedAt(db, input.orgId), nowMs)
  const { from, to } = inquiryRange(nowMs, lookback)
  const maxPages = Math.max(1, Math.min(input.maxPages ?? MAX_PAGES, 10))

  const rows: Record<string, unknown>[] = []
  let fetched = 0
  let lastFail: G2bResult<unknown> | null = null

  for (let page = 1; page <= maxPages; page += 1) {
    const res = await searchNotices({ serviceKey, from, to, pageNo: page, fetchImpl: input.fetchImpl })
    if (!res.ok) {
      // 첫 쪽부터 실패면 사유를 돌려주고, 뒷쪽 실패면 **가져온 것까지는 담는다**
      if (page === 1) return { ...empty, reason: res.reason, guide: res.fallback }
      lastFail = res
      break
    }
    fetched += res.data.items.length
    for (const item of res.data.items) rows.push(toDbColumns(toSourceRow(item), input.orgId))
    // 한 쪽이 덜 찼으면 더 없는 것이다
    if (res.data.items.length === 0) break
  }

  if (rows.length === 0) {
    return { ...empty, fetched, reason: lastFail?.ok === false ? lastFail.reason : null }
  }

  // 이미 담은 것은 빼고 보낸다 — 유니크가 막아 주지만 매번 100건을 다시 넣으면
  // 실패 로그가 그만큼 쌓여 진짜 고장이 안 보인다
  const noticeNos = rows.map((r) => r.notice_no).filter(Boolean)
  const { data: seen } = await db.from('rfp_sources')
    .select('notice_no, notice_round')
    .eq('org_id', input.orgId)
    .in('notice_no', noticeNos)
  const seenKeys = new Set(
    ((seen ?? []) as Record<string, unknown>[]).map((r) => `${r.notice_no}:${r.notice_round ?? ''}`),
  )

  const fresh = rows.filter((r) => !seenKeys.has(`${r.notice_no}:${r.notice_round ?? ''}`))
  if (fresh.length === 0) return { ...empty, fetched, skipped: rows.length }

  const { error } = await db.from('rfp_sources').insert(fresh)
  // supabase-js 는 실패를 던지지 않고 돌려준다. 검사하지 않으면 0건이 성공으로 보인다
  if (error && String((error as { code?: string }).code) !== '23505') {
    return { ...empty, fetched, reason: 'insert_failed', guide: String((error as { message?: string }).message ?? '') }
  }

  return {
    fetched,
    inserted: fresh.length,
    skipped: rows.length - fresh.length,
    reason: null,
    guide: null,
  }
}

/**
 * 마지막으로 공고를 담은 때.
 *
 * 따로 칸을 두지 않고 **이미 담은 것 중 가장 최근**을 본다. 칸을 새로 두면 그 칸을
 * 올리는 코드가 또 배선이 되고, 안 이어지면 폭이 늘 최대가 된다.
 *
 * 못 읽으면 null 을 돌려 기본폭으로 간다 — 넓게 훑는 것이 안 훑는 것보다 낫다.
 */
async function lastCollectedAt(db: CollectDb, orgId: string): Promise<number | null> {
  try {
    const { data } = await db.from('rfp_sources')
      .select('created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1)
    const row = ((data ?? []) as { created_at?: unknown }[])[0]
    if (!row?.created_at) return null
    const ms = Date.parse(String(row.created_at))
    return Number.isFinite(ms) ? ms : null
  } catch {
    return null
  }
}
