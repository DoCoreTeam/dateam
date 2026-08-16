// GET    /api/crm/stages/:id — 지우기 전에 무엇이 걸려 있는지
// PATCH  /api/crm/stages/:id — 진입 조건 바꾸기 · 이름 바꾸기
// DELETE /api/crm/stages/:id — 단계 지우기 (딜 0건일 때만)
//
// 진입 조건은 "이 단계까지 왔으면 최소한 이건 정해졌다"는 약속이다.
// 그 약속을 관리자가 이 경로로 정하고, 딜 이동이 그걸 실제로 본다(deal.ts checkEntryCriteria).
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { setStageCriteria } from '@/lib/crm/services/pipeline'
import { getCrmDb } from '@/lib/crm/db/client'
import { stageUsage, renameStage, deleteStage } from '@/lib/crm/services/pipeline-admin'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    // 이름과 조건은 서로 다른 일이라 한 번에 섞지 않는다 — 섞으면 무엇이 바뀌었는지 기록이 흐려진다
    if (typeof body.name === 'string') {
      return { stage: await renameStage(session.workspaceId, session.memberId, id, body.name) }
    }
    return setStageCriteria(session.workspaceId, session.memberId, id, body.criteria)
  })
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    return { usage: await stageUsage(db, id) }
  })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    return { deleted: await deleteStage(session.workspaceId, session.memberId, id) }
  })
}
