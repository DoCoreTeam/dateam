// POST /api/crm/meetings/[id]/restore — 휴지통에서 되살리기
//
// 삭제 확인창이 「30일 안에 되돌릴 수 있어요」라고 약속한다.
// 서비스만 있고 API 가 없으면 그 약속은 화면에서 지켜지지 않는다
// (회사·인물·딜·견적은 진작 갖고 있었는데 미팅만 빠져 있었다).
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { restoreMeeting } from '@/lib/crm/services/meeting'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    await restoreMeeting(session.workspaceId, session.memberId, id)
    return { ok: true }
  })
}
