// POST /api/crm/quotes/[id]/approve — 임계를 넘은 할인을 승인한다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { approveQuote, toQuoteJson } from '@/lib/crm/services/quote'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const quote = await approveQuote(session.workspaceId, session.memberId, params.id, version)
    return toQuoteJson(quote)
  })
}
