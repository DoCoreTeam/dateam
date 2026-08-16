// GET    /api/crm/companies/[id]  — 상세
// PATCH  /api/crm/companies/[id]  — 수정(낙관적 잠금)
// DELETE /api/crm/companies/[id]  — 휴지통 기본, ?mode=purge 면 영구 삭제
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import {
  getCompany, updateCompany, deleteCompany, type UpdateCompanyInput,
} from '@/lib/crm/services/company'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => getCompany(db, params.id))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return updateCompany(session.workspaceId, session.memberId, params.id,
      { ...body, version } as unknown as UpdateCompanyInput)
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    // 영구 삭제는 되돌릴 수 없으므로 **명시해야만** 한다. 기본은 휴지통이다.
    const mode = new URL(req.url).searchParams.get('mode') === 'purge' ? 'purge' : 'trash'
    await deleteCompany(session.workspaceId, session.memberId, params.id, mode)
    return { ok: true, mode }
  })
}
