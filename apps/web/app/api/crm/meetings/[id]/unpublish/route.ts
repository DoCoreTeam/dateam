// POST /api/crm/meetings/:id/unpublish — 회의노트 연결만 끊는다
//
// 미팅을 지우지 않는다. 되돌릴 수 있어야 사람이 부담 없이 발행한다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { unpublishNote } from '@/lib/crm/services/meeting-publish'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) =>
    unpublishNote(session.workspaceId, session.memberId, id))
}
