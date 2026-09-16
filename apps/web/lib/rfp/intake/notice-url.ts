/**
 * 붙여넣은 공고 링크를 읽는다
 *
 * ## 왜 링크인가
 *
 * 사람이 공고를 볼 때 손에 쥐고 있는 것은 **주소창의 주소**다. 공고번호가 아니다.
 * 번호를 물으면 사람은 공고 쪽으로 돌아가 번호를 찾아 옮겨 적는다 —
 * 우리가 주소만 보면 알 수 있는 것을 사람에게 시키는 것이다.
 *
 * ## 나라장터는 주소를 읽고, 기관 게시판은 쪽을 읽는다
 *
 * 나라장터 상세 쪽은 프레임과 자바스크립트라 HTML 을 받아도 첨부가 안 나온다.
 * 대신 주소 안에 **공고번호가 그대로 있다**(`bidno=20250912345`). 그 번호로 열린 API 를 부른다.
 * 기관 자체 게시판은 반대다 — API 가 없고 쪽 HTML 안에 내려받기 링크가 있다.
 *
 * 그래서 여기서 갈래를 정한다. 갈래를 안 정하고 한 가지로 밀면
 * 나라장터 링크는 늘 「첨부 0건」이 되고, 사용자는 링크가 안 된다고 결론짓는다.
 *
 * ## 사설 주소는 거절한다
 *
 * 여기 들어오는 주소는 **사람이 적은 값**이고 서버가 그 주소로 직접 나간다.
 * `http://127.0.0.1:54321` 을 넣으면 우리 내부망을 대신 두드려 주는 창구가 된다.
 * 그래서 http/https 가 아니거나 사설 대역이면 받기 전에 막는다.
 */

/** 링크를 못 쓰는 사유 — 화면이 이 이름으로 안내 문구를 고른다 */
export type NoticeUrlReason =
  | 'empty'
  | 'not_a_url'
  | 'not_http'
  | 'private_host'
  /** 나라장터 주소인데 공고번호가 안 보인다 — 목록 쪽 주소를 붙여넣은 경우가 대부분이다 */
  | 'no_notice_no'

export type NoticeUrlParse =
  | { ok: true; kind: 'g2b'; url: string; noticeNo: string; round: number | null }
  | { ok: true; kind: 'page'; url: string; noticeNo: null; round: null }
  | { ok: false; reason: NoticeUrlReason }

/** 나라장터 도메인 — 서브도메인과 포트가 붙어도 같은 곳이다 */
export const G2B_HOST = /(^|\.)g2b\.go\.kr$/i

/**
 * 공고번호가 들어오는 질의 이름들.
 *
 * 나라장터가 개편되면서 이름이 바뀌었고 **옛 주소가 아직 돌아다닌다.**
 * 하나만 보면 어제 받은 링크는 되고 오늘 받은 링크는 안 되는 모양이 된다.
 */
export const NOTICE_NO_PARAMS = ['bidno', 'bidNtceNo', 'bidPbancNo', 'ntceNo'] as const

/** 차수가 들어오는 질의 이름들 */
export const ROUND_PARAMS = ['bidseq', 'bidNtceOrd', 'bidPbancOrd', 'ntceOrd'] as const

/** 중첩 주소를 몇 겹까지 풀나 — 나라장터 프레임 주소는 두 겹이다 */
const MAX_DECODE = 3

/**
 * 주소를 읽어 어느 갈래인지 정한다.
 *
 * 실패를 던지지 않고 값으로 돌려준다 — 사람이 적은 값이라 틀린 것이 정상이고,
 * 화면은 「왜 안 되는지」를 보여 줘야 한다.
 */
export function parseNoticeUrl(raw: unknown): NoticeUrlParse {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { ok: false, reason: 'empty' }

  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return { ok: false, reason: 'not_a_url' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'not_http' }
  }
  if (isPrivateHost(parsed.hostname)) return { ok: false, reason: 'private_host' }

  if (!G2B_HOST.test(parsed.hostname)) {
    return { ok: true, kind: 'page', url: parsed.toString(), noticeNo: null, round: null }
  }

  const noticeNo = noticeNoOf(text)
  if (!noticeNo) return { ok: false, reason: 'no_notice_no' }
  return { ok: true, kind: 'g2b', url: parsed.toString(), noticeNo, round: roundOf(text) }
}

/**
 * 주소 어디에 있든 공고번호를 찾는다.
 *
 * 나라장터 링크는 프레임 주소 안에 진짜 주소가 **인코딩된 채로 들어 있다** —
 * `selectSubFrame.do?framesrc=%2Fpt%2Fmenu%2FframeTgong.do%3Furl%3D...%3Fbidno%3D20250912345`.
 * `searchParams` 로 보면 `framesrc` 하나뿐이라 공고번호가 안 잡힌다. 그래서 풀어서 글자로 훑는다.
 */
export function noticeNoOf(url: string): string | null {
  const flat = decodeDeep(url)
  for (const name of NOTICE_NO_PARAMS) {
    const m = flat.match(new RegExp(`[?&#]${name}=([A-Za-z0-9-]{6,25})`, 'i'))
    if (m) return m[1]
  }
  return null
}

/** 차수. 없으면 null — 0 과 「없음」은 다르다, 0 차는 실재한다 */
export function roundOf(url: string): number | null {
  const flat = decodeDeep(url)
  for (const name of ROUND_PARAMS) {
    const m = flat.match(new RegExp(`[?&#]${name}=(\\d{1,3})`, 'i'))
    if (m) return Number(m[1])
  }
  return null
}

/** 더 안 풀릴 때까지 푼다. 깨진 인코딩이면 거기서 멈춘다 */
export function decodeDeep(url: string): string {
  let out = url
  for (let i = 0; i < MAX_DECODE; i += 1) {
    let next: string
    try {
      next = decodeURIComponent(out)
    } catch {
      return out
    }
    if (next === out) return out
    out = next
  }
  return out
}

/** 사설 대역과 루프백 — 서버가 대신 두드려 주면 안 되는 곳 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host.startsWith('fd') || host.startsWith('fe80:')) return true
  if (host === 'metadata.google.internal') return true

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/**
 * 쪽에서 공고 이름을 뽑는다.
 *
 * 순서는 og:title → title → h1 이다. og:title 은 쪽이 **스스로 밝힌 제목**이라
 * 메뉴 이름이 섞이지 않는다. `<title>` 은 대개 「제목 | 기관이름」 모양이다.
 *
 * 꼬리를 자를 때 **가장 긴 토막을 고른다.** 앞을 고르면 「홈 > 입찰공고 > 제목」에서
 * 「홈」이 사업명이 된다. 사업명은 거의 언제나 가장 긴 토막이다.
 */
export function titleFromPage(html: string): string | null {
  const og = html.match(
    /<meta[^>]+(?:property|name)\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i,
  ) ?? html.match(
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["']og:title["']/i,
  )
  const head = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)

  for (const raw of [og?.[1], head?.[1], h1?.[1]]) {
    const clean = cleanTitleText(raw)
    if (clean) return clean
  }
  return null
}

/** 제목 토막을 나누는 글자 — 하이픈은 안 쓴다, 사업명 안에 흔하다 */
const TITLE_SPLIT = /\s*[|<>»›]\s*|\s*::\s*|\s+[—–]\s+/

/** 이 길이 아래는 메뉴 이름으로 본다 */
export const MIN_TITLE = 4

export function cleanTitleText(raw: string | undefined): string | null {
  if (!raw) return null
  const text = decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!text) return null

  const parts = text.split(TITLE_SPLIT).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null

  const longest = parts.reduce((best, p) => (p.length > best.length ? p : best), '')
  const picked = longest.length >= MIN_TITLE ? longest : text
  return picked.length >= MIN_TITLE ? picked : null
}

/** 제목에 흔한 것만 푼다 — 여기서 HTML 전체를 해석할 일은 없다 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}
