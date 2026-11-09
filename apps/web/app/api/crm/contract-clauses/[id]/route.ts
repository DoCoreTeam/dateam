// GET    /api/crm/contract-clauses/[id] — 조항 한 줄
// PATCH  /api/crm/contract-clauses/[id] — 고치기 (version 필요). 승인본이면 다음 번호 초안이 생긴다
// DELETE /api/crm/contract-clauses/[id] — 초안 지우기. 승인본은 지우지 않는다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { getClause, updateClause, deleteClauseDraft, type ClauseInput } from '@/lib/crm/services/contract-clause'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => getClause(db, (await params).id))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return updateClause(db, session.workspaceId, session.memberId, (await params).id, version, body as ClauseInput)
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    await deleteClauseDraft(db, session.workspaceId, session.memberId, (await params).id)
    return { ok: true }
  })
}
