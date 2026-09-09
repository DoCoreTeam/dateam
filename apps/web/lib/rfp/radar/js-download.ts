/**
 * 자바스크립트로 내려받는 첨부의 주소를 그 사이트의 코드에서 읽어 낸다 (K02)
 *
 * ## 왜 필요한가
 *
 * 기관 게시판의 절반은 첨부가 `href` 가 아니라 **onclick** 이다 —
 * 실측(KISA): `onclick="fnPostAttachDownload(403,'10843',1,'KO')"`, href 는 `#` 이다.
 * 링크만 보면 첨부가 없는 공고로 보이고, 케이스에 파일이 0건이 된다.
 *
 * ## 사이트마다 규칙을 박지 않는다
 *
 * 함수 이름도 인자 순서도 기관마다 다르다. 그래서 **그 사이트의 자바스크립트에서
 * 함수 정의를 찾아** 주소와 인자 이름을 읽는다. 기관이 게시판을 바꾸면 그 코드도 같이 바뀐다.
 *
 * ## 만든 주소는 반드시 검증한다
 *
 * 읽어 만든 주소가 맞는지는 **열어 봐야** 안다. 파일이 오는 응답
 * (`content-disposition` 이 붙은)만 첨부로 인정한다 — 안 그러면 오류 쪽을 파일로 저장한다.
 */

/** onclick 으로 부르는 내려받기 호출 한 건 */
export interface DownloadCall {
  fnName: string
  args: string[]
  /** 링크 글자 — 대개 파일 이름과 크기가 들어 있다 */
  text: string
}

/** 내려받기로 보이는 함수 이름 */
const DOWNLOAD_FN = /(download|filedown|fndown|attach)/i

/** 미리보기·뷰어는 첨부가 아니다 */
const PREVIEW_FN = /(preview|viewer)/i

/**
 * 쪽에서 onclick 내려받기 호출을 뽑는다.
 *
 * `pageUrl` 을 주면 **이 공고의 첨부만** 남긴다. 게시판 푸터에도 같은 내려받기 함수가
 * 있어서(실측 KISA: 「KISA소개 자료」 `fnPostAttachDownload(99999999,1,1,'KO')`)
 * 그냥 담으면 기관 브로슈어가 공고 첨부로 케이스에 붙는다.
 * 판정은 **호출 인자에 이 쪽 주소의 값이 들어 있는가** — 글 번호를 공유하면 이 공고의 것이다.
 */
export function downloadCalls(html: string, pageUrl?: string): DownloadCall[] {
  const out: DownloadCall[] = []
  const RE = /<a\b[^>]*onclick\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi

  for (let m = RE.exec(html); m !== null; m = RE.exec(html)) {
    const handler = (m[1] ?? m[2] ?? '').replace(/^\s*javascript:\s*/i, '')
    const call = handler.match(/([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/)
    if (!call) continue

    const fnName = call[1]
    if (!DOWNLOAD_FN.test(fnName) || PREVIEW_FN.test(fnName)) continue

    const args = call[2].split(',')
      .map((a) => a.trim().replace(/^['"]|['"]$/g, ''))
      .filter((a) => a.length > 0)
    if (args.length === 0) continue

    const text = (m[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    out.push({ fnName, args, text })
  }

  if (!pageUrl) return out
  const own = pageValues(pageUrl)
  if (own.size === 0) return out

  const mine = out.filter((c) => c.args.some((a) => own.has(a)))
  // 하나도 안 맞으면 거르지 않는다 — 주소에 글 번호가 없는 게시판도 있다
  return mine.length > 0 ? mine : out
}

/**
 * 이 쪽 주소에서 **이 공고를 가르는 값**만.
 *
 * 쪽 번호는 뺀다 — `page=1` 이 남으면 푸터의 `fnPostAttachDownload(99999999, 1, 1, 'KO')` 가
 * 인자 `1` 로 걸려서 기관 브로슈어가 공고 첨부로 딸려 온다(실측 2026-09-10 KISA).
 * 한 자리 값도 뺀다 — 우연히 겹칠 확률이 너무 높다.
 */
export const PAGING_PARAMS = new Set([
  'page', 'pageindex', 'pageno', 'currentpage', 'curpage', 'rows', 'size', 'perpage', 'pagesize',
])

function pageValues(pageUrl: string): Set<string> {
  try {
    const out = new Set<string>()
    for (const [k, v] of new URL(pageUrl).searchParams) {
      if (PAGING_PARAMS.has(k.toLowerCase())) continue
      if (v.length < 2) continue
      out.add(v)
    }
    return out
  } catch {
    return new Set()
  }
}

export interface FnShape {
  /** 요청을 보내는 경로 */
  action: string
  /** 인자 이름들 — 함수 선언 순서 그대로 */
  params: string[]
  /** 질의 이름 → 몇 번째 인자인가 */
  mapping: { query: string; argIndex: number }[]
}

/**
 * 함수 정의에서 주소와 인자 짝을 읽는다.
 *
 * 두 모양을 다룬다.
 * ① jQuery 폼 조립: `.attr("action","/post/fileDownload")` + `{name:'postSeq', value:post_seq}`
 * ② 주소 조립: `location.href = "/down?seq=" + seq`
 */
export function parseFnShape(js: string, fnName: string): FnShape | null {
  const decl = new RegExp(`function\\s+${escapeRe(fnName)}\\s*\\(([^)]*)\\)\\s*\\{`, 'i')
  const at = js.search(decl)
  if (at < 0) return null

  const params = (js.match(decl)?.[1] ?? '').split(',').map((p) => p.trim()).filter(Boolean)
  const body = js.slice(at, at + MAX_BODY_CHARS)

  const action = body.match(/["']((?:\/|https?:\/\/)[^"'\s]+)["']/)?.[1]
  if (!action) return null

  const mapping: { query: string; argIndex: number }[] = []

  // ① 폼 조립 — name 과 value 가 짝으로 온다
  const PAIR = /name\s*:\s*['"]([^'"]+)['"]\s*,\s*value\s*:\s*([A-Za-z_$][\w$]*)/g
  for (let m = PAIR.exec(body); m !== null; m = PAIR.exec(body)) {
    const idx = params.indexOf(m[2])
    if (idx >= 0) mapping.push({ query: m[1], argIndex: idx })
  }

  // ② 주소 조립 — `?a=" + x` 또는 `&b=" + y`
  if (mapping.length === 0) {
    const CONCAT = /[?&]([A-Za-z_][\w]*)=["']?\s*\+\s*([A-Za-z_$][\w$]*)/g
    for (let m = CONCAT.exec(body); m !== null; m = CONCAT.exec(body)) {
      const idx = params.indexOf(m[2])
      if (idx >= 0) mapping.push({ query: m[1], argIndex: idx })
    }
  }

  return mapping.length > 0 ? { action, params, mapping } : null
}

/** 함수 본문을 이만큼만 본다 — 파일 전체를 훑으면 다음 함수까지 섞인다 */
export const MAX_BODY_CHARS = 1200

/** 호출과 함수 모양으로 실제 주소를 만든다 */
export function buildDownloadUrl(call: DownloadCall, shape: FnShape, pageUrl: string): string | null {
  try {
    const u = new URL(shape.action, pageUrl)
    let filled = 0
    for (const { query, argIndex } of shape.mapping) {
      const v = call.args[argIndex]
      if (v === undefined) continue
      u.searchParams.set(query, v)
      filled += 1
    }
    // 인자를 하나도 못 채웠으면 그건 이 호출의 주소가 아니다
    return filled > 0 ? u.toString() : null
  } catch {
    return null
  }
}

/** 쪽에 딸린 자바스크립트 파일 주소들 — 함수 정의가 여기 있다 */
export function scriptUrls(html: string, pageUrl: string, limit = MAX_SCRIPTS): string[] {
  const out: string[] = []
  const RE = /<script\b[^>]*src\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  for (let m = RE.exec(html); m !== null && out.length < limit; m = RE.exec(html)) {
    const raw = (m[1] ?? m[2] ?? '').trim()
    if (!raw || !/\.js(\?|$)/i.test(raw)) continue
    // 남의 라이브러리에는 우리 함수가 없다
    if (/(jquery|swiper|slick|bootstrap|chart|analytics|gtag)/i.test(raw)) continue
    try {
      out.push(new URL(raw, pageUrl).toString())
    } catch {
      // 못 만드는 주소는 건너뛴다
    }
  }
  return out
}

/** 훑을 스크립트 수 — 많이 받으면 한 공고를 여는 데 몇 초가 걸린다 */
export const MAX_SCRIPTS = 6

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
