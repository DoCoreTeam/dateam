// GET    /api/crm/people/[id]
// PATCH  /api/crm/people/[id]  — 낙관적 잠금
// DELETE /api/crm/people/[id]  — 휴지통 기본, ?mode=purge 면 영구 삭제
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import {
  getPerson, updatePerson, deletePerson, type UpdatePersonInput,
} from '@/lib/crm/services/person'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => getPerson(db, params.id))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return updatePerson(session.workspaceId, session.memberId, params.id,
      { ...body, version } as unknown as UpdatePersonInput)
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const mode = new URL(req.url).searchParams.get('mode') === 'purge' ? 'purge' : 'trash'
    await deletePerson(session.workspaceId, session.memberId, params.id, mode)
    return { ok: true, mode }
  })
}
