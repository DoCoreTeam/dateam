/**
 * 공고 상세 쪽에서 첨부를 찾아낸다 (K02)
 *
 * ## 왜 필요한가
 *
 * 나라장터 열린 API 는 첨부 주소를 칸으로 준다(`ntceSpecDocUrl1~10`).
 * 그런데 **기관 자체 게시판은 그런 게 없다** — 상세 쪽 HTML 안에 내려받기 링크로만 있다.
 * 그걸 못 찾으면 케이스를 만들어도 분석할 파일이 0건이고, 사용자는
 * 「리포트가 없다」만 본다(실측 2026-09-10).
 *
 * ## 이름은 링크 글자에서 얻는다
 *
 * 링크 주소는 `Download.do?bcIdx=29975&fileNo=1` 처럼 이름이 없다.
 * 링크 안의 글자가 대개 파일 이름이다. 그것도 없으면 헤더에서 얻는다
 * (`downloadAttachment` 가 Content-Disposition 을 읽는다).
 */

import { ATTACHMENT_HREF } from './detail-url.ts'
import { absolute, fetchPage } from './site-collect.ts'
import { downloadCalls, parseFnShape, buildDownloadUrl, scriptUrls } from './js-download.ts'
import type { NoticeAttachment } from '../g2b/attachments.ts'

/** 한 공고에서 받을 첨부 수 상한 — 서식이 수십 개 붙는 공고가 있다 */
export const MAX_FOUND = 12

/** 첨부가 아닌 것 — 바로가기·미리보기·뷰어 */
const NOT_FILE = /(바로\s*가기|미리\s*보기|뷰어|viewer|preview)/i

/**
 * 상세 쪽 HTML 에서 첨부 목록을 뽑는다.
 *
 * 같은 파일이 두 번 걸리는 게시판이 많다(아이콘 링크 + 글자 링크).
 * 주소로 한 번만 담는다 — 두 번 받으면 같은 파일이 케이스에 두 줄이 된다.
 */
export function attachmentsFromPage(html: string, pageUrl: string): NoticeAttachment[] {
  const out: NoticeAttachment[] = []
  const seen = new Set<string>()

  const RE = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi
  for (let m = RE.exec(html); m !== null && out.length < MAX_FOUND; m = RE.exec(html)) {
    const raw = (m[1] ?? m[2] ?? '').trim()
    if (!raw || !ATTACHMENT_HREF.test(raw)) continue

    const url = absolute(raw, pageUrl)
    if (seen.has(url)) continue

    const text = (m[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (NOT_FILE.test(text)) continue

    seen.add(url)
    out.push({
      // 이름은 링크 글자 → 없으면 자리 번호. 진짜 이름은 받을 때 헤더에서 다시 본다
      fileName: text || `첨부${out.length + 1}`,
      url,
      slot: out.length + 1,
    })
  }
  return out
}

/**
 * onclick 으로 내려받는 첨부까지 찾는다.
 *
 * 링크(`href`)에 없으면 **그 사이트의 자바스크립트를 읽어** 주소를 만든다.
 * 실측(KISA): 첨부가 `fnPostAttachDownload(403,'10843',1,'KO')` 이고 href 는 `#` 이라
 * href 만 보면 첨부 없는 공고로 보였다.
 *
 * 스크립트를 받는 값이 있으므로 **href 로 이미 찾았으면 안 부른다.**
 */
export async function attachmentsFromPageDeep(
  html: string, pageUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<NoticeAttachment[]> {
  const direct = attachmentsFromPage(html, pageUrl)
  if (direct.length > 0) return direct

  const calls = downloadCalls(html, pageUrl)
  if (calls.length === 0) return []

  // 함수 정의를 찾는다 — 쪽 안에 있을 수도, 딸린 스크립트에 있을 수도 있다
  const sources: string[] = [html]
  for (const url of scriptUrls(html, pageUrl)) {
    const js = await fetchPage(url, fetchImpl)
    if (js.ok) sources.push(js.html)
  }

  const out: NoticeAttachment[] = []
  const seen = new Set<string>()

  for (const call of calls) {
    if (out.length >= MAX_FOUND) break
    const shape = sources.map((src) => parseFnShape(src, call.fnName)).find(Boolean)
    if (!shape) continue

    const url = buildDownloadUrl(call, shape, pageUrl)
    if (!url || seen.has(url)) continue
    seen.add(url)

    out.push({
      // 링크 글자에 파일 이름과 크기가 들어 있다 — 크기 표기는 뗀다
      fileName: call.text.replace(/\s*\([0-9.]+\s*[KMG]?B\)\s*$/i, '').trim() || `첨부${out.length + 1}`,
      url,
      slot: out.length + 1,
    })
  }
  return out
}
