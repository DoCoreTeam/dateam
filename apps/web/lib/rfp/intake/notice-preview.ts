/**
 * 붙여넣은 링크에 **무엇이 들어 있는지 먼저 본다**
 *
 * ## 왜 미리 보나
 *
 * 케이스를 먼저 만들고 「첨부 0건」을 보여 주면 사용자는 빈 케이스를 떠안는다
 * (실측 2026-09-10: 사용자가 본 것은 「리포트가 없다」뿐이었다).
 * 그래서 **저장하기 전에 보여 준다.** 이 모듈은 아무것도 쓰지 않는다.
 *
 * ## 갈래가 둘인 이유
 *
 * 나라장터 상세 쪽은 프레임과 자바스크립트라 HTML 을 받아도 첨부가 안 나온다.
 * 대신 주소에 공고번호가 있으니 열린 API 로 간다.
 * 기관 자체 게시판은 반대로 API 가 없고 쪽 HTML 안에 내려받기 링크가 있다.
 * 한 갈래로 밀면 나라장터 링크는 늘 첨부 0건이 되고, 사용자는 링크가 안 된다고 결론짓는다.
 *
 * ## 바깥을 인자로 받는 이유
 *
 * 나라장터 호출과 쪽 받기를 모듈 안에서 직접 부르면 **시험할 방법이 없다.**
 * 갈래를 잘못 타는 것이 이 기능의 가장 큰 고장인데, 그 갈래를 확인할 수 없게 된다.
 */

import type { NoticeAttachment } from '../g2b/attachments.ts'
import type { G2bResult } from '../g2b/client.ts'
import type { FetchPageResult } from '../radar/site-collect.ts'
import { parseNoticeUrl, titleFromPage } from './notice-url.ts'

export interface PreviewAttachment {
  name: string
  url: string
}

export interface NoticePreview {
  kind: 'g2b' | 'page'
  /** 사람이 직접 열어 볼 주소 — 우리가 실패해도 이건 준다 */
  url: string
  title: string | null
  noticeNo: string | null
  round: number | null
  agency: string | null
  budgetAmount: number | null
  attachments: PreviewAttachment[]
  /** 첨부를 못 찾았으면 왜 못 찾았는지 */
  reason: string | null
  /** 나라장터에서 받은 원본 — 케이스를 만들 때 그대로 넘긴다 */
  raw: Record<string, unknown> | null
}

export interface PreviewFail {
  error: string
  /** 사유마다 다음에 무엇을 하면 되는지 — 나라장터 쪽은 이미 가지고 있다 */
  fallback: string | null
  url: string | null
  status: number
}

export interface PreviewDeps {
  /** 나라장터 서비스 키. 없으면 null — 아직 설정을 안 한 것이지 오류가 아니다 */
  serviceKey(): Promise<string | null>
  fetchNotice(input: { noticeNo: string; round?: number; serviceKey: string }):
    Promise<G2bResult<Record<string, unknown>>>
  /** 나라장터 응답에서 첨부 칸을 꺼낸다 */
  attachmentsOf(row: Record<string, unknown>): NoticeAttachment[]
  /** 공고 행을 우리 칸 이름으로 */
  toSourceRow(row: Record<string, unknown>): {
    title: string | null; noticeNo: string | null; noticeRound: number | null
    announcingAgency: string | null; demandAgency: string | null; budgetAmount: number | null
  }
  fetchPage(url: string): Promise<FetchPageResult>
  attachmentsFromPage(html: string, url: string): Promise<NoticeAttachment[]>
  /** 키가 없을 때 보여 줄 안내 */
  noKeyGuide: string
}

export function isFail(v: NoticePreview | PreviewFail): v is PreviewFail {
  return 'error' in v
}

/** 링크 하나를 읽어 무엇이 들어 있는지 돌려준다. 저장은 하지 않는다 */
export async function previewNotice(
  rawUrl: unknown, deps: PreviewDeps,
): Promise<NoticePreview | PreviewFail> {
  const parsed = parseNoticeUrl(rawUrl)
  // 주소가 틀린 것은 오류가 아니라 사람이 고칠 수 있는 상태다. 사유를 그대로 준다
  if (!parsed.ok) return { error: parsed.reason, fallback: null, url: null, status: 400 }

  return parsed.kind === 'g2b'
    ? fromG2b(parsed.noticeNo, parsed.round, parsed.url, deps)
    : fromPage(parsed.url, deps)
}

/** 나라장터 — 주소에서 뽑은 공고번호로 열린 API 를 부른다 */
async function fromG2b(
  noticeNo: string, round: number | null, url: string, deps: PreviewDeps,
): Promise<NoticePreview | PreviewFail> {
  const serviceKey = await deps.serviceKey()
  if (!serviceKey) {
    return { error: 'no_service_key', fallback: deps.noKeyGuide, url, status: 409 }
  }

  const got = await deps.fetchNotice({ noticeNo, round: round ?? undefined, serviceKey })
  if (!got.ok) {
    return {
      error: got.reason,
      fallback: got.fallback,
      url,
      status: got.reason === 'not_found' ? 404 : 502,
    }
  }

  const row = deps.toSourceRow(got.data)
  const attachments = deps.attachmentsOf(got.data).map(toPreviewAttachment)
  return {
    kind: 'g2b',
    url,
    title: row.title,
    noticeNo: row.noticeNo ?? noticeNo,
    round: row.noticeRound ?? round,
    agency: row.announcingAgency ?? row.demandAgency,
    budgetAmount: row.budgetAmount,
    attachments,
    reason: attachments.length === 0 ? 'no_attachment' : null,
    raw: got.data,
  }
}

/** 기관 자체 게시판 — 쪽을 열어 제목과 내려받기 링크를 찾는다 */
async function fromPage(url: string, deps: PreviewDeps): Promise<NoticePreview | PreviewFail> {
  const page = await deps.fetchPage(url)
  // 쪽을 못 열면 그 자체가 답이다. 「첨부 0건」으로 뭉뚱그리면 원인이 사라진다
  if (!page.ok) return { error: page.reason ?? 'fetch_failed', fallback: null, url, status: 502 }

  const found = await deps.attachmentsFromPage(page.html, url)
  return {
    kind: 'page',
    url,
    title: titleFromPage(page.html),
    noticeNo: null,
    round: null,
    agency: null,
    budgetAmount: null,
    attachments: found.map(toPreviewAttachment),
    reason: found.length === 0 ? 'no_attachment_on_page' : null,
    raw: null,
  }
}

function toPreviewAttachment(a: NoticeAttachment): PreviewAttachment {
  return { name: a.fileName, url: a.url }
}
