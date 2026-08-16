// GET /api/crm/pipelines — 파이프라인과 단계 (보드가 컬럼을 그리는 데 쓴다)
import { withCrmApi } from '@/lib/crm/api/handler'

export async function GET() {
  return withCrmApi('READONLY', async ({ db }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).crmPipeline.findMany({
      select: {
        id: true, name: true, isDefault: true,
        stages: {
          select: { id: true, name: true, position: true, kind: true },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })
    return { items: rows }
  })
}
