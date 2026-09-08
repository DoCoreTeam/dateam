// PATCH  /api/crm/business-types/:id — 이름 바꾸기 · 숨김/보임
// DELETE /api/crm/business-types/:id — 지우기(쓰이지 않는 사용자 추가 유형만)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { updateBusinessType, deleteBusinessType } from '@/lib/crm/services/business-type'

type Ctx = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return updateBusinessType(session.workspaceId, session.memberId, params.id, body)
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    await deleteBusinessType(session.workspaceId, session.memberId, params.id)
    return { ok: true }
  })
}
