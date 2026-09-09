/**
 * 기관 자체 사이트에서 공고를 모은다 (사용자 개입)
 *
 * ## 왜 나라장터만으로는 안 되나
 *
 * 입찰 공고는 **기관 자기 게시판에도 올라온다.** 지자체·공사·출연연은 자체 게시판에
 * 먼저 붙이고 나라장터에는 늦게 올리거나 아예 안 올리기도 한다.
 * 나라장터만 보면 그 며칠을 늘 늦게 안다.
 *
 * ## 사이트마다 스크레이퍼를 만들지 않는다
 *
 * 게시판 HTML 구조는 기관마다 다르고 개편 때마다 바뀐다. 선택자를 박으면
 * 기관이 게시판을 손볼 때마다 우리 코드가 조용히 0건이 된다.
 * 그래서 **글자와 링크만 뽑아 AI 에게 「공고 줄」을 물어본다.**
 *
 * ## 그래도 규칙이 먼저다
 *
 * 링크와 날짜는 규칙이 확실하게 뽑는다. AI 는 「이 줄이 공고인가, 제목은 어디까지인가」만 푼다.
 */

import { recoverJson, asJsonRecord } from '../../ai/json-recover.ts'
import { stripHtml } from '../parse/plain.ts'

/** 한 쪽에서 읽을 글자 상한. 게시판 한 쪽은 대개 이 안에 들어온다 */
export const MAX_PAGE_CHARS = 60_000

/** 한 번에 받아들일 공고 수 — 넘치면 사람이 확인을 포기한다 */
export const MAX_NOTICES = 50

/** 페이지를 기다리는 시간. 기관 사이트는 느린 곳이 많다 */
export const FETCH_TIMEOUT_MS = 20_000

export interface SiteLink {
  text: string
  href: string
}

export interface SiteNotice {
  title: string
  noticeNo: string | null
  agency: string | null
  budgetAmount: number | null
  noticeDate: string | null
  url: string | null
}

/**
 * 링크를 뽑는다 — 제목과 상세 주소가 여기 붙어 있다.
 *
 * 글자만 뽑으면 「무엇을 눌러야 상세로 가나」를 잃는다. 그러면 사람이 다시 찾아야 하고,
 * 그건 레이더가 하는 일이 아니다.
 */
export function extractLinks(html: string, baseUrl?: string): SiteLink[] {
  const out: SiteLink[] = []
  const RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (let m = RE.exec(html); m !== null; m = RE.exec(html)) {
    const text = stripHtml(m[2]).replace(/\s+/g, ' ').trim()
    // 두 글자짜리 링크는 「목록」·「다음」 같은 조작 단추다
    if (text.length < 5) continue
    out.push({ text, href: absolute(m[1], baseUrl) })
  }
  return out
}

/** 상대 주소를 절대 주소로 — 상대인 채로 저장하면 나중에 아무도 못 연다 */
export function absolute(href: string, baseUrl?: string): string {
  if (!baseUrl) return href
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

/** AI 에게 보낼 몸통 — 링크 목록과 쪽 글자를 함께 준다 */
export function renderPage(html: string, links: readonly SiteLink[]): string {
  const text = stripHtml(html).replace(/\n{3,}/g, '\n\n').slice(0, MAX_PAGE_CHARS)
  const linkLines = links.slice(0, 200).map((l, i) => `[L${i}] ${l.text} -> ${l.href}`).join('\n')
  return [`링크 목록\n${linkLines}`, '', `쪽 글자\n${text}`].join('\n')
}

export function buildSitePrompt(body: string): string {
  return [
    '아래는 어느 기관 게시판의 입찰·공고 목록 쪽이다. 여기서 공고 줄만 뽑는다.',
    '',
    '지켜야 할 규칙',
    '1. 공지·안내·메뉴·페이지 번호는 공고가 아니다. 빼라',
    '2. 제목은 링크 글자를 그대로 쓴다. 줄이거나 다듬지 않는다',
    '3. url 은 링크 목록의 주소를 그대로 쓴다. 만들어 내지 않는다',
    '4. 없는 값은 null 로 둔다. 추측하지 않는다',
    '5. 금액은 원 단위 정수, 날짜는 ISO 8601(YYYY-MM-DD)',
    '',
    '아래 JSON 하나만 답한다. 다른 말을 덧붙이지 않는다.',
    '{ "notices": [{ "title": "", "noticeNo": null, "agency": null, "budgetAmount": null, "noticeDate": null, "url": null }] }',
    '',
    body,
  ].join('\n')
}

/** AI 답을 공고 줄로. 제목이 없거나 링크에 없는 주소는 버린다 */
export function parseSiteNotices(text: string, links: readonly SiteLink[]): SiteNotice[] {
  let parsed: unknown
  try {
    parsed = recoverJson(text)
  } catch {
    return []
  }
  const known = new Set(links.map((l) => l.href))
  const body = asJsonRecord(parsed)
  const rows = Array.isArray(body.notices) ? body.notices : []

  const out: SiteNotice[] = []
  for (const raw of rows) {
    const r = asJsonRecord(raw)
    const title = str(r.title)
    if (!title) continue
    const url = str(r.url)
    out.push({
      title,
      noticeNo: str(r.noticeNo),
      agency: str(r.agency),
      budgetAmount: num(r.budgetAmount),
      noticeDate: isoDate(str(r.noticeDate)),
      // **링크 목록에 없는 주소는 버린다** — 지어낸 주소를 저장하면 사람이 눌러도 안 열린다
      url: url && known.has(url) ? url : null,
    })
    if (out.length >= MAX_NOTICES) break
  }
  return out
}

/** 규칙만으로도 최소한은 뽑는다 — AI 가 없거나 죽어도 「아무것도 안 됨」이 되면 안 된다 */
export function noticesFromLinks(links: readonly SiteLink[]): SiteNotice[] {
  const SKIP = /^(목록|이전|다음|처음|마지막|더보기|검색|홈|로그인|바로가기|본문|메뉴)$/
  return links
    .filter((l) => !SKIP.test(l.text) && l.text.length >= 8)
    .slice(0, MAX_NOTICES)
    .map((l) => ({
      title: l.text, noticeNo: null, agency: null,
      budgetAmount: null, noticeDate: null, url: l.href,
    }))
}

/** 공고 줄 → rfp_sources 행 */
export function toSourceRows(
  notices: readonly SiteNotice[], orgId: string, siteName: string,
): Record<string, unknown>[] {
  return notices.map((n) => ({
    org_id: orgId,
    source_system: 'agency',
    // 공고번호가 없으면 주소가 그 자리를 대신한다 — 유니크 판정에 쓰인다
    notice_no: n.noticeNo ?? n.url ?? null,
    notice_round: null,
    title: n.title,
    announcing_agency: n.agency ?? siteName,
    budget_amount: n.budgetAmount,
    notice_date: n.noticeDate,
    raw: { url: n.url, site: siteName },
    fetched_at: new Date().toISOString(),
  }))
}

export interface FetchPageResult {
  ok: boolean
  html: string
  reason: string | null
}

/** 쪽을 받아 온다. 실패를 값으로 돌려준다 — 한 사이트가 죽었다고 훑기 전체를 멈추지 않는다 */
export async function fetchPage(
  url: string, fetchImpl: typeof fetch = fetch, timeoutMs = FETCH_TIMEOUT_MS,
): Promise<FetchPageResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      // 사람이 보는 것과 같은 쪽을 받아야 한다. 기본 UA 를 막는 기관 사이트가 있다
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; RFP-Radar/1.0)' },
    })
    if (!res.ok) return { ok: false, html: '', reason: `http_${res.status}` }
    return { ok: true, html: await res.text(), reason: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, html: '', reason: message.includes('abort') ? 'timeout' : 'fetch_failed' }
  } finally {
    clearTimeout(timer)
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^0-9]/g, ''))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}
/** 날짜 모양이 아니면 버린다 — 「2026년 9월」 같은 것을 날짜 칸에 넣으면 정렬이 깨진다 */
function isoDate(v: string | null): string | null {
  if (!v) return null
  const m = v.match(/(\d{4})[-.\/년\s]*(\d{1,2})[-.\/월\s]*(\d{1,2})/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}
