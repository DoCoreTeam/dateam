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
    const raw = m[1]
    // **앵커(#)를 버리지 않는다.** 한국 공공기관 게시판은 줄마다 `href="#view"` 를 쓰고
    // 실제 이동은 자바스크립트가 한다 — 버리면 제목까지 함께 잃는다(실측 NIA)
    out.push({ text, href: raw.startsWith('#') ? raw : absolute(raw, baseUrl) })
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

/**
 * 규칙만으로 뽑는다 — AI 가 없거나 죽었을 때.
 *
 * ## 왜 「긴 링크를 다 담기」가 틀렸나
 *
 * 처음에는 글자가 긴 링크를 전부 공고로 봤다. 실측(NIA 게시판): **50건 중 대부분이
 * 내비게이션이었다** — 「인공지능융합본부」·「전체메뉴 바로가기」·「팝업 알림 닫기」.
 * 그 쓰레기가 `rfp_sources` 에 쌓이면 조건에 걸려 알림으로 나가고, 사용자는 레이더를 끈다.
 *
 * ## 목록은 「같은 모양의 주소가 여럿」이다
 *
 * 게시판 목록은 **같은 경로에 번호만 다른 링크가 여러 줄** 있다(`/bbs/View.do?id=101,102,…`).
 * 메뉴는 그렇지 않다 — 경로가 제각각이다. 그래서 주소 모양으로 무리를 지어
 * **가장 큰 무리**를 목록으로 본다. 기관마다 다른 HTML 구조를 안 봐도 된다.
 */
export function noticesFromLinks(links: readonly SiteLink[]): SiteNotice[] {
  return pickNoticeGroup(links).slice(0, MAX_NOTICES).map((l) => ({
    title: cleanTitle(l.text), noticeNo: null, agency: null,
    // 앵커는 주소가 아니다. 없는 것을 있는 척하면 눌러도 안 열린다
    budgetAmount: null, noticeDate: dateFromRow(l.text), url: l.href.startsWith('#') ? null : l.href,
  }))
}

/** 목록으로 볼 만한 무리가 되려면 이만큼은 있어야 한다 */
export const MIN_GROUP = 3

/** 메뉴·조작 단추로 보이는 글자 */
const NAV_TEXT = /(바로가기|전체메뉴|메뉴|닫기|열기|로그인|회원가입|검색|더보기|이전|다음|처음|마지막|본부$|팝업|사이트맵|개인정보|이용약관)/

/**
 * 링크를 주소 모양으로 묶어 가장 큰 무리를 돌려준다.
 *
 * 모양 = 경로 + 질의 이름들(값 제외). `?id=101` 과 `?id=102` 는 같은 모양이다.
 */
export function pickNoticeGroup(links: readonly SiteLink[]): SiteLink[] {
  const groups = new Map<string, SiteLink[]>()
  const seen = new Set<string>()

  for (const l of links) {
    if (!l.href || l.href.startsWith('#')) continue
    if (l.href.includes('#')) continue
    if (NAV_TEXT.test(l.text)) continue
    if (l.text.length < 8) continue
    if (seen.has(l.href)) continue
    seen.add(l.href)

    const shape = urlShape(l.href)
    // 질의도 번호도 없는 주소는 목록 줄이 아니라 대개 메뉴다
    if (!shape.hasVariable) continue
    groups.set(shape.key, [...(groups.get(shape.key) ?? []), l])
  }

  // **큰 무리가 아니라 「상세로 가는」 무리를 고른다.**
  //
  // 실측(NIA): 가장 큰 무리가 사이드바의 게시판 목록(`List.do?cbIdx=…`)이었다 —
  // 「국가지능정보화백서」·「인터넷이용실태조사」가 공고로 담겼다.
  // 목록 쪽의 각 줄은 **상세 화면**을 가리킨다. 그 성질로 무리를 가른다.
  let best: SiteLink[] = []
  for (const list of Array.from(groups.values())) {
    if (list.length < MIN_GROUP) continue
    // **목록으로 가는 무리는 안 쓴다.** 실측(NIA): 사이드바의 게시판 목록이 가장 큰
    // 무리라서 「국가지능정보화백서」·「인터넷이용실태조사」가 공고로 담겼다
    if (!looksDetail(list[0].href)) continue
    if (list.length > best.length) best = list
  }
  if (best.length > 0) return best

  // 상세 주소가 하나도 없으면 자바스크립트 게시판이다 — 제목만이라도 건진다
  return jsBoardGroup(links)
}

/**
 * 자바스크립트 게시판의 줄들.
 *
 * 줄마다 `href="#view"` 로 같고 이동은 스크립트가 한다. **주소는 못 얻지만 제목은 얻는다** —
 * 「이런 공고가 떴다」를 아는 것만으로도 사람이 사이트를 열어 볼 이유가 된다.
 * 주소가 없다는 사실은 호출부가 화면에 그대로 적는다.
 */
export function jsBoardGroup(links: readonly SiteLink[]): SiteLink[] {
  const byHref = new Map<string, SiteLink[]>()
  for (const l of links) {
    if (!l.href.startsWith('#')) continue
    if (NAV_TEXT.test(l.text)) continue
    if (l.text.length < 8) continue
    byHref.set(l.href, [...(byHref.get(l.href) ?? []), l])
  }
  let best: SiteLink[] = []
  for (const list of Array.from(byHref.values())) if (list.length > best.length) best = list
  // 제목이 다 같으면 목록이 아니다(같은 단추가 반복된 것)
  const unique = new Map(best.map((l) => [l.text, l]))
  const rows = Array.from(unique.values())
  return rows.length >= MIN_GROUP ? rows : []
}

/**
 * 목록 줄에서 제목만 남긴다.
 *
 * 게시판 한 줄은 링크 안에 **제목 말고도 다 넣는다** — 실측(NIA):
 * 「[조달입찰공고] … 첨부파일 있음 new 2026.09.09 조회수 108 이용진 재무관리팀」.
 * 그대로 두면 조건 검색이 「조회수」에 걸리고 목록이 못 읽는다.
 *
 * 날짜는 버리지 않고 **뽑아서 돌려준다** — 공고일은 정렬에 쓰인다.
 */
export function cleanTitle(text: string): string {
  return text
    .replace(/첨부파일\s*있음/g, ' ')
    .replace(/\bnew\b/gi, ' ')
    .replace(/조회수\s*[\d,]+/g, ' ')
    .replace(/\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\.?/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    // 끝에 남은 담당자·부서를 자른다. 이름은 두세 글자 + 팀 이름이 붙는다
    .replace(/\s+\S{2,4}\s+\S*(팀|과|부|실|센터)$/, '')
    .trim()
}

/** 목록 줄에서 공고일을 건진다 */
export function dateFromRow(text: string): string | null {
  const m = text.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

/** 상세 화면으로 가는 주소인가 — 목록으로 가는 주소는 공고 줄이 아니다 */
export function looksDetail(href: string): boolean {
  const lower = href.toLowerCase()
  if (/\blist\b|list\.do|\/list/.test(lower)) return false
  return /(view|detail|read|show|article|nttid|bbsidx|boardidx|seq=|idx=|no=|id=)/.test(lower)
}

/** 주소를 모양으로 — 값은 빼고 경로와 질의 이름만 본다 */
export function urlShape(href: string): { key: string; hasVariable: boolean } {
  try {
    const u = new URL(href, 'https://x.invalid')
    const names = Array.from(u.searchParams.keys()).sort().join(',')
    // 경로 끝의 숫자도 변하는 자리다(/notice/1234)
    const path = u.pathname.replace(/\/\d+(?=\/|$)/g, '/*')
    return { key: `${path}?${names}`, hasVariable: names.length > 0 || path.includes('*') }
  } catch {
    return { key: href, hasVariable: false }
  }
}

/**
 * 같은 공고인지 가리는 열쇠.
 *
 * 공고번호 > 주소 > **제목** 순이다. 셋 다 없으면 안 되는 이유:
 * 자바스크립트 게시판은 주소가 없어서 `notice_no` 가 null 이 되고,
 * 그러면 「이미 담았나」 검사가 아무것도 못 찾아 **훑을 때마다 같은 공고가 다시 담긴다**
 * (실측 2026-09-09: 7건이 두 번 돌아 12건이 됐다).
 * 제목은 사이트 이름과 함께 묶어 다른 기관의 같은 제목과 안 섞이게 한다.
 */
export function sourceKey(n: SiteNotice, siteName: string): string {
  if (n.noticeNo) return n.noticeNo
  if (n.url) return n.url
  return `title:${siteName}:${n.title}`.slice(0, 300)
}

/** 공고 줄 → rfp_sources 행 */
export function toSourceRows(
  notices: readonly SiteNotice[], orgId: string, siteName: string,
): Record<string, unknown>[] {
  return notices.map((n) => ({
    org_id: orgId,
    source_system: 'agency',
    notice_no: sourceKey(n, siteName),
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
