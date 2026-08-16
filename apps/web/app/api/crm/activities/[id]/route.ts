import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { deleteActivity } from '@/lib/crm/services/activity'

type Ctx = { params: { id: string } }

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const mode = new URL(req.url).searchParams.get('mode') === 'purge' ? 'purge' : 'trash'
    await deleteActivity(session.workspaceId, session.memberId, params.id, mode)
    return { ok: true, mode }
  })
}
