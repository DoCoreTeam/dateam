// PATCH  /api/crm/quote-terms/:id — 조건 고치기
// DELETE /api/crm/quote-terms/:id — 조건 내리기(소프트 삭제)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { updateQuoteTerm, deleteQuoteTerm } from '@/lib/crm/services/quote-term'

type Ctx = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return updateQuoteTerm(session.workspaceId, session.memberId, params.id, body)
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    await deleteQuoteTerm(session.workspaceId, session.memberId, params.id)
    return { ok: true }
  })
}
