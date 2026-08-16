// GET /api/crm/pipelines — 파이프라인·단계·진입 조건
//
// 보드가 컬럼을 그리는 데 쓰고, 프로세스 화면이 조건을 편집하는 데 쓴다.
// 두 화면이 각자 조회하면 같은 값을 다르게 읽는다 — 서비스 하나를 함께 쓴다.
import { withCrmApi } from '@/lib/crm/api/handler'
import { listPipelines } from '@/lib/crm/services/pipeline'

export async function GET() {
  return withCrmApi('READONLY', async ({ db }) => {
    return { items: await listPipelines(db) }
  })
}
