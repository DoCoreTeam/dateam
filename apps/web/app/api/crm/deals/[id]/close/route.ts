// POST /api/crm/deals/[id]/close — 성사·실주·재오픈
// 전이 판정은 canTransit SSOT 가 한다(DI-06·07·08). 여기서 다시 구현하지 않는다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { closeDeal, toDealJson, type CloseDealInput } from '@/lib/crm/services/deal'
import { CrmError } from '@/lib/crm/domain/errors'

type Ctx = { params: { id: string } }
const ALLOWED = new Set(['WON', 'LOST', 'OPEN'])

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const to = String(body.to ?? '')
    if (!ALLOWED.has(to)) {
      throw new CrmError('VALIDATION_FAILED', '성사·실주·재오픈 중 하나여야 합니다.', { field: 'to' })
    }
    const deal = await closeDeal(session.workspaceId, session.memberId, params.id,
      { ...body, version, to } as unknown as CloseDealInput)
    return toDealJson(deal)
  })
}
