import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getTask, updateTask, deleteTask, type UpdateTaskInput } from '@/lib/crm/services/task'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => getTask(db, params.id))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return updateTask(session.workspaceId, session.memberId, params.id, body as unknown as UpdateTaskInput)
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const mode = new URL(req.url).searchParams.get('mode') === 'purge' ? 'purge' : 'trash'
    await deleteTask(session.workspaceId, session.memberId, params.id, mode)
    return { ok: true, mode }
  })
}
