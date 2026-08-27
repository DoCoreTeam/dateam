import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { addInKind, toLedgerJson, type InKindInputDto } from '@/lib/crm/services/ledger'
import { viewerOf } from '@/lib/crm/auth/capabilities'
import { requireCostEdit } from '@/lib/crm/auth/capabilities-gate'

type Ctx = { params: { id: string } }

/** 현물 한 줄 추가 — 명세는 원가를 역산할 수 있어 능력을 확인한다 */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const viewer = await viewerOf(db, session)
    requireCostEdit(viewer)
    const body = await readJson(req) as unknown as InKindInputDto
    const ledger = await addInKind(db, session.workspaceId, params.id, body, session.memberId)
    return toLedgerJson(ledger, viewer)
  })
}
