/**
 * 공고 하나를 케이스로 만든다 — **첨부까지 받아서**
 *
 * ## 왜 한자리에 모았나
 *
 * 이 일을 하는 길이 둘이다. 레이더가 고른 공고를 받는 길과, 사람이 링크를 붙여넣는 길.
 * 두 벌로 두면 한쪽만 고쳐진다 — 이 저장소가 이미 겪은 모양이다
 * (시세 새로고침이 자동 경로와 화면 경로로 갈라져 자동 경로만 옛 코드로 남았다).
 *
 * ## 첨부가 0건이면 분석을 안 건다
 *
 * 분석을 걸면 파서는 읽을 것이 없고, 사용자는 「내용 없음」짜리 리포트를 받는다.
 * 그건 고장보다 나쁘다 — 고장은 다시 하면 되지만 빈 리포트는 결과처럼 보인다.
 * 그래서 케이스는 남기되 **분석은 안 걸고, 왜 비었는지와 공고 주소를 함께 돌려준다.**
 *
 * ## 첨부 하나가 실패해도 케이스는 산다
 *
 * 기관 파일 서버는 자주 막힌다. 한 파일 때문에 전체를 되돌리면 사람은 처음부터 다시 한다.
 * 받은 것은 저장하고 못 받은 것은 이름과 사유로 남긴다 — 그 파일만 직접 올리면 된다.
 */

import type { NoticeAttachment } from '../g2b/attachments.ts'
import type { DocClass } from '../domain/doc-class.ts'

/** 한 공고에서 받을 첨부 수 상한 — 서식이 수십 개 붙는 공고가 있다 */
export const MAX_ATTACHMENTS = 12

export interface AdoptInput {
  sourceId: string
  orgId: string
  title: string | null
  docClass: DocClass
  userId: string
  budgetAmount: number | null
  attachments: readonly NoticeAttachment[]
  /** 사람이 직접 열어 볼 공고 주소 */
  noticeUrl: string | null
  /** 첨부를 못 찾았으면 왜 못 찾았는지 — 0건일 때만 쓴다 */
  emptyReason: string | null
  /**
   * 분석을 지금 걸 것인가. 기본은 건다.
   *
   * 링크와 파일을 함께 준 경우만 끈다 — 지금 걸면 뒤에 올라온 파일이 빠진 채로 읽힌다.
   * 그때는 화면이 파일을 다 올린 다음 분석 창구를 따로 부른다.
   */
  analyze?: boolean
}

export interface AdoptedFile {
  name: string
  reason: string
}

export interface AdoptResult {
  caseId: string
  /** 이미 만들어 둔 케이스를 그대로 준 것인가 */
  reused: boolean
  attached: string[]
  failed: AdoptedFile[]
  job: { id: string; status: string } | null
  noticeUrl: string | null
  attachmentReason: string | null
}

/** 내려받기 결과 — 실패를 값으로 돌려준다 */
export type DownloadResult =
  | { ok: true; fileName: string; bytes: Uint8Array; contentType: string | null }
  | { ok: false; reason: string }

export interface SaveFileInput {
  caseId: string
  orgId: string
  userId: string
  fileName: string
  bytes: Uint8Array
  contentType: string | null
  sourceUrl: string
}

/** 저장 결과. 같은 파일이 두 번 붙어 있는 공고가 흔하다 — 그건 실패가 아니다 */
export type SaveOutcome = 'saved' | 'duplicate' | { failed: string }

export interface AdoptPorts {
  /** 이 공고로 이미 만든 케이스 */
  findCase(sourceId: string): Promise<{ id: string } | null>
  createCase(input: {
    sourceId: string; orgId: string; title: string; docClass: DocClass
    budgetAmount: number | null; userId: string
  }): Promise<{ id: string } | null>
  download(att: NoticeAttachment): Promise<DownloadResult>
  saveFile(input: SaveFileInput): Promise<SaveOutcome>
  enqueueParse(input: { caseId: string; orgId: string; userId: string }):
    Promise<{ id: string; status: string } | null>
  /** 레이더 목록에서 이 공고를 처리됨으로 바꾼다 */
  markAdopted(sourceId: string, caseId: string): Promise<void>
}

/** 이름을 아직 모를 때 — 분석이 진짜 사업명을 찾으면 대신한다 */
export const TITLE_PENDING = '이름을 읽는 중'

export async function adoptSource(
  input: AdoptInput, ports: AdoptPorts,
): Promise<AdoptResult | { error: string }> {
  // 같은 공고로 이미 만든 케이스가 있으면 그것을 준다 — 두 번 만들면 분석 비용이 두 배다
  const existing = await ports.findCase(input.sourceId)
  if (existing) {
    return {
      caseId: existing.id, reused: true, attached: [], failed: [], job: null,
      noticeUrl: input.noticeUrl, attachmentReason: null,
    }
  }

  const kase = await ports.createCase({
    sourceId: input.sourceId,
    orgId: input.orgId,
    title: input.title?.trim() || TITLE_PENDING,
    docClass: input.docClass,
    budgetAmount: input.budgetAmount,
    userId: input.userId,
  })
  if (!kase) return { error: 'case_create_failed' }

  const attached: string[] = []
  const failed: AdoptedFile[] = []

  for (const att of input.attachments.slice(0, MAX_ATTACHMENTS)) {
    const got = await ports.download(att)
    if (!got.ok) {
      // 첨부 하나가 안 받아진다고 케이스를 죽이지 않는다 — 사람이 그 파일만 올리면 된다
      failed.push({ name: att.fileName, reason: got.reason })
      continue
    }

    const outcome = await ports.saveFile({
      caseId: kase.id,
      orgId: input.orgId,
      userId: input.userId,
      fileName: got.fileName,
      bytes: got.bytes,
      contentType: got.contentType,
      sourceUrl: att.url,
    })
    if (outcome === 'saved') attached.push(got.fileName)
    else if (outcome !== 'duplicate') failed.push({ name: got.fileName, reason: outcome.failed })
  }

  // 첨부가 하나도 없으면 분석을 걸지 않는다 — 빈 리포트가 「내용 없음」으로 나온다
  let job: { id: string; status: string } | null = null
  if (attached.length > 0 && input.analyze !== false) {
    job = await ports.enqueueParse({ caseId: kase.id, orgId: input.orgId, userId: input.userId })
  }

  await ports.markAdopted(input.sourceId, kase.id)

  return {
    caseId: kase.id,
    reused: false,
    attached,
    failed,
    job,
    // 첨부를 못 찾았으면 **왜 못 찾았는지**와 사람이 열어 볼 주소를 준다 —
    // 이게 없으면 화면은 「리포트가 없다」만 말하게 된다
    noticeUrl: input.noticeUrl,
    attachmentReason: attached.length === 0 ? (input.emptyReason ?? 'no_attachment') : null,
  }
}
