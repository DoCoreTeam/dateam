import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { getDeal, updateDeal, deleteDeal, toDealJson, type UpdateDealInput } from '@/lib/crm/services/deal'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => toDealJson(await getDeal(db, (await params).id)))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const deal = await updateDeal(session.workspaceId, session.memberId, (await params).id,
      { ...body, version } as unknown as UpdateDealInput)
    return toDealJson(deal)
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const mode = new URL(req.url).searchParams.get('mode') === 'purge' ? 'purge' : 'trash'
    await deleteDeal(session.workspaceId, session.memberId, (await params).id, mode)
    return { ok: true, mode }
  })
}
