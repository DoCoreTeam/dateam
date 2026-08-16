// PATCH  /api/crm/members/:id — 권한 바꾸기
// DELETE /api/crm/members/:id — 내보내기(소프트 삭제)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { changeMemberRole, removeMember } from '@/lib/crm/services/member'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return changeMemberRole(session.workspaceId, session.memberId, id, body.role)
  })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    await removeMember(session.workspaceId, session.memberId, id)
    return { ok: true }
  })
}
