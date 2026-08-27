import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { updateInKind, removeInKind, toLedgerJson, type InKindInputDto } from '@/lib/crm/services/ledger'
import { viewerOf } from '@/lib/crm/auth/capabilities'
import { requireCostEdit } from '@/lib/crm/auth/capabilities-gate'

type Ctx = { params: { id: string; itemId: string } }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const viewer = await viewerOf(db, session)
    requireCostEdit(viewer)
    const body = await readJson(req) as unknown as Partial<InKindInputDto>
    return toLedgerJson(await updateInKind(db, params.id, params.itemId, body, session.memberId), viewer)
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const viewer = await viewerOf(db, session)
    requireCostEdit(viewer)
    return toLedgerJson(await removeInKind(db, params.id, params.itemId, session.memberId), viewer)
  })
}
