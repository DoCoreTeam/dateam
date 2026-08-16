// POST /api/crm/stages — 단계 추가 (관리자)
// PUT  /api/crm/stages — 단계 순서 바꾸기 (관리자)
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { addStage, reorderStages } from '@/lib/crm/services/pipeline-admin'

export async function POST(req: Request) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return {
      stage: await addStage(session.workspaceId, session.memberId, {
        pipelineId: String(body.pipelineId ?? ''),
        name: String(body.name ?? ''),
        position: typeof body.position === 'number' ? body.position : undefined,
      }),
    }
  })
}

export async function PUT(req: Request) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return {
      result: await reorderStages(
        session.workspaceId, session.memberId,
        String(body.pipelineId ?? ''),
        Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : []),
    }
  })
}
