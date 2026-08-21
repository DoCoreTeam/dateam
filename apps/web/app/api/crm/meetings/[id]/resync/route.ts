// POST /api/crm/meetings/:id/resync — 원본 회의노트에서 다시 가져온다
//
// 노트가 발행 뒤에 수정되면 CRM 의 스냅샷은 옛것이 된다. 조용히 어긋나게 두지 않고
// 화면이 "원본이 그 뒤 수정됐어요"라고 말하며, 이 라우트가 따라잡는다.
// 옛 미처리 제안은 거둔다 — 없어진 내용이 사람 손을 거쳐 CRM 에 들어가면 안 된다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { resyncFromNote } from '@/lib/crm/services/meeting-publish'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) =>
    resyncFromNote(session.workspaceId, session.memberId, session.hostUserId, id))
}
