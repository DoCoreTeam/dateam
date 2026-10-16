// GET    /api/crm/contract-templates/[id] — 템플릿과 발행한 버전들
// PATCH  /api/crm/contract-templates/[id] — 이름, 사업 유형, 기본, 작성 중 본문 (관리자, version 필요)
// DELETE /api/crm/contract-templates/[id] — 휴지통 (관리자)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import {
  getContractTemplate, listTemplateVersions, updateContractTemplate, deleteContractTemplate,
  type TemplateInput,
} from '@/lib/crm/services/contract-template'

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

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    await deleteContractTemplate(session.workspaceId, session.memberId, (await params).id)
    return { ok: true }
  })
}
