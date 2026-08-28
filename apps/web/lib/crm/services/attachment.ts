/**
 * 첨부 — 명함 사진·계약서·증빙 (기획 차수 0)
 *
 * **왜 우리 저장소인가**: 명함과 계약서는 작고, 이 건과 **함께 남아야** 한다.
 * 드라이브 링크로 두면 누가 폴더를 옮기는 순간 견적서의 근거가 사라진다
 * (CI 자료는 영상이라 드라이브가 맞다 — 성격이 다르다).
 *
 * **버킷은 비공개다.** 매입 견적서에는 우리 원가가 그대로 있다.
 * 내려받기는 **잠깐 열리는 주소**(signed URL)로만 준다 — 링크가 새어도 곧 만료된다.
 *
 * **종류가 민감도를 정한다.** 사람이 고르는 것이 아니라 표에서 나온다
 * (`ATTACHMENT_KIND_SENSITIVITY`) — 고르게 하면 반드시 잘못 고른다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import {
  ATTACHMENT_KIND_SENSITIVITY, ATTACHMENT_KIND_ORDER, ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_OK, ATTACHMENT,
  type AttachmentKind, type AttachmentTarget,
} from '../../terms/attachment.ts'

const BUCKET = 'crm-attachment'

const SELECT = {
  id: true, targetType: true, targetId: true, fileUrl: true, fileName: true,
  mimeType: true, sizeBytes: true, kind: true, sensitivity: true,
  uploadedById: true, createdAt: true,
} as const

export interface AttachmentRow {
  id: string
  targetType: AttachmentTarget
  targetId: string
  /** 버킷 안의 경로. **공개 주소가 아니다** — 내려받을 때 잠깐 여는 주소를 만든다 */
  fileUrl: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  kind: AttachmentKind
  sensitivity: string
  uploadedById: string | null
  createdAt: Date
}

const TARGETS: readonly AttachmentTarget[] =
  ['DEAL', 'COMPANY', 'PERSON', 'MEETING', 'QUOTE', 'DEAL_COST', 'IN_KIND']

export function assertTarget(v: string): AttachmentTarget {
  if (!TARGETS.includes(v as AttachmentTarget)) {
    throw new CrmError('VALIDATION_FAILED', `모르는 첨부 대상입니다: ${v}`, { field: 'targetType' })
  }
  return v as AttachmentTarget
}

export function assertKind(v: string | undefined | null): AttachmentKind {
  if (!v) return 'OTHER'
  if (!ATTACHMENT_KIND_ORDER.includes(v as AttachmentKind)) {
    throw new CrmError('VALIDATION_FAILED', `모르는 첨부 종류입니다: ${v}`, { field: 'kind' })
  }
  return v as AttachmentKind
}

/** 올리기 전 검사 — 서버 메모리를 통과하므로 여기서 막는다 */
export function assertFile(size: number, mime: string): void {
  if (size > ATTACHMENT_MAX_BYTES) {
    throw new CrmError('VALIDATION_FAILED', ATTACHMENT.tooBig, { field: 'file' })
  }
  if (!ATTACHMENT_MIME_OK.includes(mime)) {
    throw new CrmError('VALIDATION_FAILED', ATTACHMENT.badType, { field: 'file' })
  }
}

/**
 * 버킷 안 경로.
 *
 * 워크스페이스로 한 겹 나누고 그 아래 대상별로 둔다 — 나중에 워크스페이스를 통째로
 * 지우거나 옮길 때 경로만 보고 할 수 있다. 파일명은 **원본을 쓰지 않는다**:
 * 같은 이름이 겹치고, 한글·공백이 URL 에서 깨진다. 원본 이름은 DB 에 따로 남는다.
 */
export function storagePath(workspaceId: string, target: AttachmentTarget, targetId: string, ext: string): string {
  const stamp = Math.random().toString(36).slice(2, 10)
  return `${workspaceId}/${target.toLowerCase()}/${targetId}/${Date.now()}-${stamp}${ext ? `.${ext}` : ''}`
}

export function extensionOf(fileName: string, mime: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot > 0 && dot < fileName.length - 1) return fileName.slice(dot + 1).toLowerCase()
  const guess: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf',
  }
  return guess[mime] ?? ''
}

export async function listAttachments(
  db: CrmDb, target: AttachmentTarget, targetId: string,
): Promise<AttachmentRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmAttachment.findMany({
    where: { targetType: target, targetId },
    select: SELECT,
    orderBy: { createdAt: 'desc' },
  }) as Promise<AttachmentRow[]>
}

export interface RecordAttachmentInput {
  target: AttachmentTarget
  targetId: string
  path: string
  fileName: string
  mimeType: string
  sizeBytes: number
  kind: AttachmentKind
}

/** 업로드가 끝난 뒤 **DB 에 등록**한다. 파일만 올리고 여기 없으면 아무도 못 찾는다 */
export async function recordAttachment(
  workspaceId: string, actorId: string | null, input: RecordAttachmentInput,
): Promise<AttachmentRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any).crmAttachment.create({
      data: {
        workspaceId,
        targetType: input.target,
        targetId: input.targetId,
        fileUrl: input.path,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        kind: input.kind,
        // **종류가 민감도를 정한다** — 사람이 고르면 반드시 잘못 고른다
        sensitivity: ATTACHMENT_KIND_SENSITIVITY[input.kind],
        uploadedById: actorId,
      },
      select: SELECT,
    }) as AttachmentRow

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'attachment.created',
      targetType: 'attachment', targetId: row.id,
      afterJson: { fileName: input.fileName, kind: input.kind, target: input.target },
    })
    return row
  })
}

/**
 * 지우기 — **파일도 함께 지운다.**
 * DB 행만 지우면 버킷에 아무도 모르는 파일이 영원히 남는다(관계·삭제 계약 R-1 «소유»).
 */
export async function deleteAttachment(
  workspaceId: string, actorId: string | null, id: string,
  removeFile: (path: string) => Promise<void>,
): Promise<void> {
  const path = await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmAttachment.findFirst({
      where: { id }, select: { id: true, fileUrl: true, fileName: true },
    }) as { id: string; fileUrl: string; fileName: string } | null
    if (!before) throw new CrmError('NOT_FOUND', '첨부를 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmAttachment.delete({ where: { id } })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'attachment.deleted',
      targetType: 'attachment', targetId: id, beforeJson: { fileName: before.fileName },
    })
    return before.fileUrl
  })

  /*
    파일 삭제는 **트랜잭션 밖**이다. 스토리지는 롤백되지 않으므로 안에서 지우면
    DB 가 실패했을 때 파일만 사라진 상태가 된다 — 그 반대(행은 없는데 파일이 남음)가
    훨씬 낫다. 남은 파일은 나중에 청소할 수 있지만, 사라진 파일은 되돌릴 수 없다.
  */
  await removeFile(path)
}

export function toAttachmentJson(r: AttachmentRow): Record<string, unknown> {
  return {
    id: r.id,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    kind: r.kind,
    sensitivity: r.sensitivity,
    createdAt: r.createdAt,
    // **경로는 안 보낸다.** 내려받기는 별도 요청으로 잠깐 여는 주소를 받는다
  }
}

export { BUCKET }
