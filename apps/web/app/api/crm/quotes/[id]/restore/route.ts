// POST /api/crm/quotes/[id]/restore — 휴지통에서 되살린다
//
// 회사·딜과 같은 약속이다: "지워도 되돌릴 수 있다".
// 되살릴 길이 없으면 사용자는 지우기를 무서워하고, 잘못 만든 초안이 영원히 목록에 남는다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { restoreQuote, toQuoteJson } from '@/lib/crm/services/quote'

type Ctx = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const quote = await restoreQuote(session.workspaceId, session.memberId, params.id)
    return toQuoteJson(quote)
  })
}
