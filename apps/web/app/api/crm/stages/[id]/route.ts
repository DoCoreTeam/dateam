// PATCH /api/crm/stages/:id — 단계 진입 조건 바꾸기
//
// 진입 조건은 "이 단계까지 왔으면 최소한 이건 정해졌다"는 약속이다.
// 그 약속을 관리자가 이 경로로 정하고, 딜 이동이 그걸 실제로 본다(deal.ts checkEntryCriteria).
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { setStageCriteria } from '@/lib/crm/services/pipeline'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return setStageCriteria(session.workspaceId, session.memberId, id, body.criteria)
  })
}
