// POST /api/crm/people/[id]/restore — 휴지통에서 되살리기
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { restorePerson } from '@/lib/crm/services/person'

type Ctx = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) =>
    restorePerson(session.workspaceId, session.memberId, params.id))
}
