import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { restoreTask } from '@/lib/crm/services/task'

type Ctx = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) =>
    restoreTask(session.workspaceId, session.memberId, params.id))
}
