// GET    /api/crm/pipelines/[id] — 지우기 전에 무엇이 걸려 있는지
// PATCH  /api/crm/pipelines/[id] — 이름 바꾸기 · 기본으로 지정 (관리자)
// DELETE /api/crm/pipelines/[id] — 지우기 (관리자, 딜 0건일 때만)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import {
  pipelineUsage, renamePipeline, deletePipeline, setDefaultPipeline,
} from '@/lib/crm/services/pipeline-admin'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    return { usage: await pipelineUsage(db, id) }
  })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    // 기본 지정과 이름변경은 서로 다른 일이라 한 번에 섞지 않는다
    if (body.isDefault === true) {
      return { pipeline: await setDefaultPipeline(session.workspaceId, session.memberId, id) }
    }
    return {
      pipeline: await renamePipeline(
        session.workspaceId, session.memberId, id, String(body.name ?? '')),
    }
  })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    return { deleted: await deletePipeline(session.workspaceId, session.memberId, id) }
  })
}
