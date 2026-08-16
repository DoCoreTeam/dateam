// GET  /api/crm/pipelines — 파이프라인·단계·진입 조건
// POST /api/crm/pipelines — 새 영업 단계 만들기 (관리자)
//
// 보드가 컬럼을 그리는 데 쓰고, 설정 화면이 편집하는 데 쓴다.
// 두 화면이 각자 조회하면 같은 값을 다르게 읽는다 — 서비스 하나를 함께 쓴다.
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listPipelines } from '@/lib/crm/services/pipeline'
import { createPipeline } from '@/lib/crm/services/pipeline-admin'

export async function GET() {
  return withCrmApi('READONLY', async ({ db }) => {
    return { items: await listPipelines(db) }
  })
}

export async function POST(req: Request) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const created = await createPipeline(session.workspaceId, session.memberId, {
      name: String(body.name ?? ''),
      stageNames: Array.isArray(body.stageNames) ? body.stageNames.map(String) : undefined,
    })
    return { pipeline: created }
  })
}
