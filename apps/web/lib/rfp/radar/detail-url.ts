/**
 * 자바스크립트 게시판의 상세 주소를 찾아낸다 (K01)
 *
 * ## 왜 필요한가
 *
 * 한국 공공기관 게시판은 줄마다 `href="#view"` 를 쓰고 이동은 스크립트가 한다 —
 * `onclick="doBbsFView('78336','29963','16010100','29963')"`.
 * 목록에서 상세 주소를 못 얻으면 **첨부도 못 얻고**, 그러면 케이스를 만들어도
 * 분석할 파일이 0건이라 리포트가 안 나온다(실측 2026-09-10: 사용자가 겪은 「리포트가 없다」).
 *
 * ## 추측하되 **검증한 것만 쓴다**
 *
 * 게시판마다 함수 이름도 인자 순서도 다르다. 그래서 규칙은 좁게 잡고,
 * 만든 주소는 **열어 보고 첨부가 있는 쪽만** 인정한다(`verifyDetailUrl`).
 * 검증 없이 쓰면 엉뚱한 쪽을 공고 상세라고 저장하게 되고, 그건 조용히 틀린다.
 */

/** 한 줄에서 뽑은 상세 후보 */
export interface DetailCandidate {
  /** 목록 줄의 글자 — 어느 공고인지 맞춰 보는 데 쓴다 */
  text: string
  /** 열어 볼 후보 주소들. 앞이 그럴듯한 순서 */
  urls: string[]
}

/** 목록 이동·검색 같은 조작 함수 — 상세가 아니다 */
const NOT_DETAIL = /^(doBbsFPag|goPage|fn_?page|doSearch|totalSearch|m_totalSearch|fn_?search)$/i

/** 상세 화면 파일 이름 후보 — 목록 파일 이름을 이걸로 바꿔 본다 */
export const DETAIL_FILES = ['View.do', 'view.do', 'Detail.do', 'read.do']

/** 상세 id 로 흔히 쓰는 질의 이름 */
export const ID_PARAMS = ['bcIdx', 'nttId', 'bbsIdx', 'idx', 'seq', 'no']

/**
 * 목록 HTML 에서 줄마다 상세 후보를 만든다.
 *
 * 규칙 하나: **목록 주소에 이미 있는 값은 상세 id 가 아니다.**
 * NIA 의 `doBbsFView('78336','29963',…)` 에서 78336 은 목록 주소의 `cbIdx` 라 게시판 번호이고,
 * 29963 이 글 번호다. 이 대조가 없으면 게시판 번호를 글 번호로 넣어 늘 같은 쪽을 연다.
 */
export function detailCandidates(html: string, listUrl: string): DetailCandidate[] {
  const known = knownValues(listUrl)
  const out: DetailCandidate[] = []

  // 바깥 따옴표와 **다른** 따옴표가 값 안에 들어 있다 —
  // `onclick="doBbsFView('78336','29963')"`. 한 벌로 묶으면 하나도 안 잡힌다
  const ROW_RE = /<a\b[^>]*onclick\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi
  for (let m = ROW_RE.exec(html); m !== null; m = ROW_RE.exec(html)) {
    const handler = m[1] ?? m[2] ?? ''
    const fn = handler.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1] ?? ''
    if (!fn || NOT_DETAIL.test(fn)) continue

    const args = Array.from(handler.matchAll(/'([^']*)'|&#0?39;([^&]*)&#0?39;|"([^"]*)"/g))
      .map((a) => (a[1] ?? a[2] ?? a[3] ?? '').trim())
      .filter((v) => /^\d{2,}$/.test(v))
    // 목록 주소에 있는 값(게시판 번호 등)은 글 번호가 아니다
    const ids = Array.from(new Set(args.filter((v) => !known.has(v))))
    if (ids.length === 0) continue

    const text = (m[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text.length < 5) continue

    out.push({ text, urls: buildUrls(listUrl, ids) })
  }
  return out
}

/** 목록 주소의 질의 값들 — 이 값은 글 번호가 아니다 */
function knownValues(listUrl: string): Set<string> {
  try {
    const u = new URL(listUrl)
    return new Set(Array.from(u.searchParams.values()))
  } catch {
    return new Set()
  }
}

/** 목록 주소를 상세 주소로 — 파일 이름을 바꾸고 글 번호를 붙인다 */
export function buildUrls(listUrl: string, ids: readonly string[]): string[] {
  let base: URL
  try {
    base = new URL(listUrl)
  } catch {
    return []
  }

  const file = base.pathname.split('/').pop() ?? ''
  const urls: string[] = []

  for (const detailFile of DETAIL_FILES) {
    if (!/\.do$/i.test(file)) continue
    const u = new URL(base.toString())
    u.pathname = base.pathname.replace(/[^/]+$/, detailFile)
    for (const id of ids) {
      for (const param of ID_PARAMS) {
        const v = new URL(u.toString())
        v.searchParams.set(param, id)
        // 같은 값을 부모 자리에도 넣는 게시판이 많다(NIA 의 parentSeq)
        v.searchParams.set('parentSeq', id)
        urls.push(v.toString())
      }
    }
  }
  // 후보가 너무 많으면 확인만 오래 걸린다 — 앞쪽 몇 개만 본다
  return urls.slice(0, MAX_CANDIDATES)
}

/** 열어 볼 후보 수 상한 — 한 줄에 수십 번 요청하면 사이트가 막는다 */
export const MAX_CANDIDATES = 8

/** 상세 쪽으로 인정할 조건 — 첨부 내려받기 링크가 있어야 한다 */
export const ATTACHMENT_HREF = /(Download\.do|FileDown\.do|fileDown|atchFileId|file[_-]?down|getFile|downloadFile)/i

export interface VerifyResult {
  url: string
  html: string
}

/**
 * 후보를 열어 본다. **첨부가 있는 쪽만** 상세로 인정한다.
 *
 * 「열렸다」로는 부족하다 — 목록 주소에 모르는 질의를 붙여도 대개 200 이 오고
 * 같은 목록이 다시 나온다. 우리가 원하는 것은 첨부라서, 첨부가 판정 기준이다.
 */
export async function verifyDetailUrl(
  urls: readonly string[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<VerifyResult | null> {
  for (const url of urls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; RFP-Radar/1.0)' },
      })
      if (!res.ok) continue
      const html = await res.text()
      if (ATTACHMENT_HREF.test(html)) return { url, html }
    } catch {
      // 한 후보가 죽어도 다음을 본다
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/** 목록 줄 글자와 공고 제목이 같은 것인가 — 앞부분이 겹치면 같은 줄로 본다 */
export function matchesTitle(rowText: string, title: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/[[\]()]/g, '')
  const a = norm(rowText)
  const b = norm(title)
  if (!a || !b) return false
  return a.includes(b.slice(0, Math.min(20, b.length))) || b.includes(a.slice(0, Math.min(20, a.length)))
}
