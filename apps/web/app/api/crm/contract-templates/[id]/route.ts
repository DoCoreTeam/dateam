// GET    /api/crm/contract-templates/[id] — 템플릿과 발행한 버전들
// PATCH  /api/crm/contract-templates/[id] — 이름, 사업 유형, 기본, 작성 중 본문 (관리자, version 필요)
// DELETE /api/crm/contract-templates/[id]?mode=trash|purge — 휴지통, 또는 템플릿과 원본 파일 영구 삭제 (관리자)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { createAdminClient } from '@/lib/supabase/server'
import {
  getContractTemplate, listTemplateVersions, updateContractTemplate, deleteContractTemplate, purgeContractTemplate,
  type TemplateInput,
} from '@/lib/crm/services/contract-template'
import { BUCKET, deleteAttachment, listAttachments } from '@/lib/crm/services/attachment'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => {
    const id = (await params).id
    return { template: await getContractTemplate(db, id), versions: await listTemplateVersions(db, id) }
  })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return updateContractTemplate(session.workspaceId, session.memberId, (await params).id, version, body as TemplateInput)
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ db, session }) => {
    const id = (await params).id
    if (req.nextUrl.searchParams.get('mode') !== 'purge') {
      await deleteContractTemplate(session.workspaceId, session.memberId, id)
      return { ok: true, mode: 'trash' }
    }
    // 원본 파일은 템플릿 화면에서만 다룬다 — 첨부 창구의 대상 목록 밖이라 여기서 함께 지운다
    const files = await listAttachments(db, 'CONTRACT_TEMPLATE', id)
    await purgeContractTemplate(session.workspaceId, session.memberId, id)
    for (const f of files) {
      await deleteAttachment(session.workspaceId, session.memberId, f.id, async (path) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = createAdminClient() as any
        await sb.storage.from(BUCKET).remove([path])
      })
    }
    return { ok: true, mode: 'purge' }
  })
}
