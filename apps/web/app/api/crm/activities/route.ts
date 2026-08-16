// GET  /api/crm/activities — 레코드 타임라인 (occurredAt 역순, 타입 필터)
// POST /api/crm/activities — 노트·통화·미팅 기록 남기기
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listActivities, createActivity, type ActivityInput } from '@/lib/crm/services/activity'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const sp = new URL(req.url).searchParams
    const limitRaw = sp.get('limit')
    return listActivities(db, {
      limit: limitRaw ? Number(limitRaw) : null,
      before: sp.get('before'),
      companyId: sp.get('companyId'),
      personId: sp.get('personId'),
      dealId: sp.get('dealId'),
      types: sp.get('types'),
    })
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return createActivity(session.workspaceId, session.memberId, body as unknown as ActivityInput)
  })
}
