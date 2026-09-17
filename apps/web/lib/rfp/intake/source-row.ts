/**
 * 미리 본 공고를 `rfp_sources` 한 줄로 바꾼다
 *
 * ## notice_no 에 주소를 넣는 이유
 *
 * 기관 게시판 공고에는 번호가 없다. 그런데 같은 공고를 두 번 담지 않으려면
 * **두 번 봐도 같은 값**이 필요하다. 그 자리에서 변하지 않는 것은 주소뿐이다
 * (레이더도 같은 규칙을 쓴다 — `sourceKey`).
 */

import type { NoticePreview } from './notice-preview.ts'

/** notice_no 칸 길이에 맞춘 상한 — 질의 문자열이 긴 주소가 있다 */
export const MAX_KEY = 300

export interface SourceRow {
  org_id: string
  source_system: 'g2b' | 'agency'
  notice_no: string
  notice_round: number | null
  title: string | null
  announcing_agency: string | null
  budget_amount: number | null
  raw: Record<string, unknown>
  fetched_at: string
}

export function sourceRowFromPreview(
  preview: NoticePreview, orgId: string, now = new Date().toISOString(),
): SourceRow {
  const isG2b = preview.kind === 'g2b'
  return {
    org_id: orgId,
    source_system: isG2b ? 'g2b' : 'agency',
    notice_no: (isG2b ? preview.noticeNo ?? preview.url : preview.url).slice(0, MAX_KEY),
    notice_round: preview.round,
    title: preview.title,
    announcing_agency: preview.agency,
    budget_amount: preview.budgetAmount,
    // 원본을 남겨야 나중에 칸 이름이 바뀌었을 때 확인할 수 있다.
    // `url` 은 첨부를 다시 찾을 때 쓰는 자리라 갈래와 무관하게 넣는다
    raw: { ...(preview.raw ?? {}), url: preview.url },
    fetched_at: now,
  }
}
