// GET    /api/crm/contract-modules/[id] — 모듈 한 줄
// PATCH  /api/crm/contract-modules/[id] — 고치기 (관리자, version 필요). 키와 종류는 안 바뀐다
// DELETE /api/crm/contract-modules/[id] — 모듈 지우기 (관리자). 조항은 라이브러리에 남는다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { getModule, updateModule, deleteModule, type ModuleInput } from '@/lib/crm/services/contract-module'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => getModule(db, (await params).id))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ db, session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return updateModule(db, session.workspaceId, session.memberId, (await params).id, version, body as ModuleInput)
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ db, session }) => {
    await deleteModule(db, session.workspaceId, session.memberId, (await params).id)
    return { ok: true }
  })
}
