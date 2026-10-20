// POST /api/crm/contract-templates/from-file — 계약서 파일로 템플릿을 만든다 (관리자)
//
// 조항을 나누고 칸 자리를 짚은 글을 **작성 중 템플릿**으로 저장한다. 발행은 사람이 확인한 뒤에 한다.
// 원본 파일은 비공개 버킷에 그 템플릿의 첨부로 남는다 — 발행할 때 서버가 그 첨부를 버전에 적는다.
// AI 가 실패해도 글만 들인 템플릿은 만들어진다(services/contract-from-file.ts).
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { createAdminClient } from '@/lib/supabase/server'
import { CrmError } from '@/lib/crm/domain/errors'
import { draftTemplateFromFile } from '@/lib/crm/services/contract-from-file'
import { createContractTemplate } from '@/lib/crm/services/contract-template'
import { recordAttachment, storagePath, extensionOf, BUCKET } from '@/lib/crm/services/attachment'
import { MAX_QUOTE_FILE_BYTES } from '@/lib/crm/services/quote-from-file'
import { CONTRACT_FROM_FILE } from '@/lib/terms/contract-doc'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

/** 화면에 돌려줄 남은 값 상한 — 수만 세고 보기는 몇 개면 된다 */
const LEFTOVER_SHOWN = 20

/**
 * 원본을 비공개 버킷에 올리고 첨부로 적는다. 형식은 브라우저 주장이 아니라 판정한 종류에서 온다 —
 * 모르는 종류면 남기지 않는다. 실패는 로그에 남기고 화면에는 attached=false 로 말한다.
 */
async function attachSource(
  workspaceId: string, actorId: string | null, templateId: string, fileName: string, bytes: Uint8Array, mime: string | null,
): Promise<boolean> {
  if (!mime) {
    console.error('[crm/contract-templates/from-file] 원본 형식을 몰라 남기지 않음', templateId)
    return false
  }
  const path = storagePath(workspaceId, 'CONTRACT_TEMPLATE', templateId, extensionOf(fileName, mime))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
  if (error) {
    console.error('[crm/contract-templates/from-file] 원본 첨부 실패', templateId, error.message)
    return false
  }
  await recordAttachment(workspaceId, actorId, {
    target: 'CONTRACT_TEMPLATE', targetId: templateId, path,
    fileName, mimeType: mime, sizeBytes: bytes.length, kind: 'CONTRACT',
  })
  return true
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      throw new CrmError('VALIDATION_FAILED', CONTRACT_FROM_FILE.parseFailed, { field: 'file' })
    }
    const file = form.get('file')
    if (!(file instanceof File)) throw new CrmError('VALIDATION_FAILED', CONTRACT_FROM_FILE.reject.empty, { field: 'file' })
    // 크기는 바이트를 읽기 전에 본다. 서비스도 한 번 더 본다
    if (file.size > MAX_QUOTE_FILE_BYTES) {
      throw new CrmError('VALIDATION_FAILED', CONTRACT_FROM_FILE.reject.too_large, { field: 'file' })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const db = getCrmDb(session.workspaceId)
    const draft = await draftTemplateFromFile(db, session.workspaceId, session.memberId, {
      fileName: file.name, mimeType: file.type || null, bytes,
    })

    const template = await createContractTemplate(session.workspaceId, session.memberId, {
      name: draft.name, draftBody: draft.clauses, sourceFileName: file.name,
    })

    /*
      원본은 **템플릿이 생긴 뒤에** 그 id 아래 올린다. 못 올려도 템플릿은 남긴다 —
      사람이 쓴 시간과 AI 비용은 이미 들었고, 원본은 다시 올릴 수 있다. 실패는 숨기지 않고 말한다.
    */
    const attached = await attachSource(session.workspaceId, session.memberId, template.id, file.name, bytes, draft.sourceMime)

    return {
      template,
      applied: draft.applied.length + draft.filled,
      rejected: draft.rejected.length,
      scrubbed: draft.scrubbed,
      leftoverCount: draft.leftover.length,
      leftover: draft.leftover.slice(0, LEFTOVER_SHOWN).map((l) => ({
        where: draft.clauses[l.clause - 1]?.title || CONTRACT_FROM_FILE.untitledClause(l.clause),
        text: l.text,
      })),
      ai: draft.ai,
      truncated: draft.truncated,
      attached,
      sourceFileName: file.name,
    }
  })
}
