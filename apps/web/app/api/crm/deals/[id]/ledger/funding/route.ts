import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { setFunding, getLedger, toLedgerJson, type FundingInputDto } from '@/lib/crm/services/ledger'
import { viewerOf } from '@/lib/crm/auth/capabilities'

type Ctx = { params: { id: string } }

/**
 * 재원을 통째로 갈아 끼운다.
 *
 * 한 줄씩 고치지 않는 이유: 재원은 «구성»이라 합이 사업비와 맞아야 뜻이 있다.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req) as unknown as { rows?: FundingInputDto[] }
    await setFunding(db, session.workspaceId, params.id, body.rows ?? [], session.memberId)
    return toLedgerJson(await getLedger(db, params.id), await viewerOf(db, session))
  })
}
