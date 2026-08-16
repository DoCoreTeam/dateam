// GET /api/crm/reports — 파이프라인 합계 (dacrm T1-12 리포트 v1)
//
// 금액은 문자열로 나간다. BigInt 는 JSON 에 못 싣고, number 로 접으면
// 큰 금액에서 조용히 값이 틀어진다 — 리포트에서 그게 일어나면 아무도 눈치 못 챈다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { buildPipelineReport } from '@/lib/crm/services/report'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const pipelineId = req.nextUrl.searchParams.get('pipelineId')?.trim() || undefined
    const db = getCrmDb(session.workspaceId)
    return { items: await buildPipelineReport(db, pipelineId) }
  })
}
