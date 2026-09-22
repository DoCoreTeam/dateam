// POST /api/crm/quotes/[id]/approve — 임계를 넘은 할인을 승인한다
//
// 멤버인 것과 **승인해도 되는 것**은 다른 질문이다(LOOP.md 7절 S2).
// 승인은 할인 임계를 넘긴 견적에만 뜨는 동작이라, 만든 사람이 곧 승인자면 임계가 뜻을 잃는다.
// 그래서 멤버 확인 위에 `quote.approve` 능력 확인을 둔다 — 역할 기본값으로는 ADMIN 이상만 가진다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { approveQuote, toQuoteJson } from '@/lib/crm/services/quote'
import { viewerOf } from '@/lib/crm/auth/capabilities'
import { requireQuoteApprove } from '@/lib/crm/auth/capabilities-gate'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    requireQuoteApprove(await viewerOf(db, session))
    const body = await readJson(req)
    const version = requireVersion(body)
    const quote = await approveQuote(session.workspaceId, session.memberId, (await params).id, version)
    return toQuoteJson(quote)
  })
}
