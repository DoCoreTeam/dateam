// POST /api/crm/deals/[id]/restore — 휴지통에서 되살리기
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { restoreDeal, toDealJson } from '@/lib/crm/services/deal'

type Ctx = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) =>
    toDealJson(await restoreDeal(session.workspaceId, session.memberId, params.id)))
}
