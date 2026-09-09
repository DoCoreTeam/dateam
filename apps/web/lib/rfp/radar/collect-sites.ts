/**
 * 등록된 기관 사이트에서 공고를 모은다 (사용자 개입)
 *
 * `site-collect.ts` 가 「쪽에서 공고 줄을 어떻게 뽑나」를 알고, 여기가 그것을
 * **DB 와 AI 에 붙인다.** 나눈 이유는 뽑는 규칙을 실행해서 확인할 수 있게 하기 위해서다.
 *
 * 한 사이트가 죽어도 던지지 않는다 — 기관 사이트는 자주 느리고 자주 막힌다.
 * 결과를 값으로 돌려주고 화면이 「이 사이트는 왜 0건인지」를 말한다.
 */

import {
  fetchPage, extractLinks, renderPage, buildSitePrompt,
  parseSiteNotices, noticesFromLinks, toSourceRows, type SiteNotice,
} from './site-collect.ts'

export interface SiteRow {
  id: string
  name: string
  kind: 'g2b' | 'web'
  url: string | null
  base_url: string | null
  enabled: boolean
}

export interface SiteDb {
  from(table: string): any
}

/** AI 한 번 부르기 — 없으면 규칙만으로 간다 */
export type SiteAsk = (prompt: string) => Promise<string>

export interface CollectSiteInput {
  orgId: string
  site: SiteRow
  ask?: SiteAsk | null
  fetchImpl?: typeof fetch
  now?: () => number
}

export interface CollectSiteResult {
  siteId: string
  siteName: string
  found: number
  inserted: number
  skipped: number
  reason: string | null
  /** AI 를 못 써서 규칙만으로 뽑았나 — 「제목만 있고 금액이 없는」 이유가 된다 */
  rulesOnly: boolean
}

export async function collectFromSite(
  db: SiteDb, input: CollectSiteInput,
): Promise<CollectSiteResult> {
  const base: CollectSiteResult = {
    siteId: input.site.id, siteName: input.site.name,
    found: 0, inserted: 0, skipped: 0, reason: null, rulesOnly: false,
  }
  if (!input.site.url) return { ...base, reason: 'no_url' }

  const page = await fetchPage(input.site.url, input.fetchImpl ?? fetch)
  if (!page.ok) return await finish(db, input, { ...base, reason: page.reason })

  const links = extractLinks(page.html, input.site.base_url ?? input.site.url)
  if (links.length === 0) return await finish(db, input, { ...base, reason: 'no_links' })

  let notices: SiteNotice[] = []
  let rulesOnly = false
  if (input.ask) {
    try {
      notices = parseSiteNotices(await input.ask(buildSitePrompt(renderPage(page.html, links))), links)
    } catch {
      notices = []
    }
  }
  if (notices.length === 0) {
    // AI 가 없거나 못 풀었으면 링크만으로 뽑는다 — 「아무것도 안 됨」이 되면 안 된다
    notices = noticesFromLinks(links)
    rulesOnly = true
  }
  if (notices.length === 0) return await finish(db, input, { ...base, reason: 'no_notices' })

  const rows = toSourceRows(notices, input.orgId, input.site.name)

  // 이미 담은 것은 빼고 보낸다 — 유니크가 막아 주지만 매번 다시 넣으면 로그만 쌓인다
  const keys = rows.map((r) => r.notice_no).filter(Boolean)
  const { data: seen } = await db.from('rfp_sources')
    .select('notice_no').eq('org_id', input.orgId).in('notice_no', keys)
  const seenSet = new Set(((seen ?? []) as { notice_no: string }[]).map((r) => String(r.notice_no)))
  const fresh = rows.filter((r) => !seenSet.has(String(r.notice_no)))

  if (fresh.length > 0) {
    const { error } = await db.from('rfp_sources').insert(fresh)
    // supabase-js 는 실패를 던지지 않고 돌려준다. 검사하지 않으면 0건이 성공으로 보인다
    if (error && String((error as { code?: string }).code) !== '23505') {
      return await finish(db, input, { ...base, found: rows.length, reason: 'insert_failed', rulesOnly })
    }
  }

  return await finish(db, input, {
    ...base,
    found: rows.length,
    inserted: fresh.length,
    skipped: rows.length - fresh.length,
    rulesOnly,
  })
}

/** 결과를 사이트 줄에 남긴다 — 화면이 「이 사이트는 왜 0건인지」를 말할 수 있게 */
async function finish(
  db: SiteDb, input: CollectSiteInput, result: CollectSiteResult,
): Promise<CollectSiteResult> {
  const at = new Date((input.now ?? Date.now)()).toISOString()
  await db.from('rfp_source_sites')
    .update({ last_run_at: at, last_result: result })
    .eq('id', input.site.id)
  return result
}
