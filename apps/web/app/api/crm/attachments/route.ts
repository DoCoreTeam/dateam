// GET  /api/crm/attachments?target=DEAL&targetId=… — 그 건의 첨부 목록
// POST /api/crm/attachments — 파일 올리기 (multipart)
//
// **비공개 버킷에 올린다.** 매입 견적서에는 우리 원가가 그대로 있어
// 공개 주소를 만들면 링크 하나로 새어 나간다. 내려받기는 잠깐 열리는 주소로만 준다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { createAdminClient } from '@/lib/supabase/server'
import { CrmError } from '@/lib/crm/domain/errors'
import { hasCapability } from '@/lib/crm/security/sensitivity'
import {
  listAttachments, recordAttachment, toAttachmentJson,
  assertTarget, assertKind, assertFile, storagePath, extensionOf, BUCKET,
} from '@/lib/crm/services/attachment'
import { ATTACHMENT } from '@/lib/terms/attachment'

/** 서버 메모리를 통과한다 — 상한은 서비스가 잡는다 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const sp = req.nextUrl.searchParams
    const target = assertTarget(sp.get('target') ?? '')
    const targetId = (sp.get('targetId') ?? '').trim()
    if (!targetId) throw new CrmError('VALIDATION_FAILED', '어느 건의 첨부인지 알려 주세요.', { field: 'targetId' })

    const db = getCrmDb(session.workspaceId)
    const rows = await listAttachments(db, target, targetId)

    /*
      **대외비 첨부는 목록에서도 뺀다.**
      「볼 수 없습니다」로 남겨 두면 그런 파일이 있다는 사실 자체가 새고,
      그걸 본 사람은 관리자에게 묻는다 — 그게 곧 유출의 시작이다.
    */
    const canSeeRestricted = hasCapability({ role: session.role }, 'cost.view')
    const visible = canSeeRestricted ? rows : rows.filter((r) => r.sensitivity !== 'RESTRICTED')
    return { items: visible.map(toAttachmentJson) }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      throw new CrmError('VALIDATION_FAILED', '파일 형식이 아닙니다.')
    }

    const entry = form.get('file')
    if (!(entry instanceof File)) throw new CrmError('VALIDATION_FAILED', '파일이 없습니다.', { field: 'file' })

    const target = assertTarget(String(form.get('target') ?? ''))
    const targetId = String(form.get('targetId') ?? '').trim()
    if (!targetId) throw new CrmError('VALIDATION_FAILED', '어느 건의 첨부인지 알려 주세요.', { field: 'targetId' })
    const kind = assertKind(form.get('kind') as string | null)

    const mime = entry.type || 'application/octet-stream'
    assertFile(entry.size, mime)

    const path = storagePath(session.workspaceId, target, targetId, extensionOf(entry.name, mime))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createAdminClient() as any
    const { error } = await sb.storage.from(BUCKET).upload(path, entry, {
      contentType: mime, upsert: false,
    })
    if (error) throw new CrmError('CONFLICT', `${ATTACHMENT.failed} ${error.message}`)

    const row = await recordAttachment(session.workspaceId, session.memberId, {
      target, targetId, path, fileName: entry.name, mimeType: mime, sizeBytes: entry.size, kind,
    })
    return toAttachmentJson(row)
  })
}
