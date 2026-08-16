// POST /api/crm/deals/:id/stage-review — 방금 옮긴 단계를 AI 가 한 번 봐 준다
//
// **이동과 분리된 이유**가 이 라우트의 존재 이유다.
// 같은 트랜잭션에 넣으면 AI 가 느린 날 저장이 느려지고, AI 가 죽는 날 저장이 죽는다.
// 무엇보다 이동을 막게 되면 그건 진입 조건표를 AI 로 다시 만든 것뿐이다 — 조언은 막지 않는다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { reviewStageMove } from '@/lib/crm/services/stage-review'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => reviewStageMove(session.workspaceId, id))
}
