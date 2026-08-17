// POST /api/crm/quotes/[id]/status — 보내기·수락·거절·만료·초안 복귀
//
// 전이를 하나의 입구로 모은다. 전이마다 라우트를 따로 두면
// 어느 하나가 canTransitQuote 를 안 부르는 날이 온다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { transitQuote, toQuoteJson } from '@/lib/crm/services/quote'
import type { QuoteStatus } from '@/lib/crm/domain/state-machines'

type Ctx = { params: { id: string } }

const ALLOWED: QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const to = String(body.to ?? '') as QuoteStatus
    if (!ALLOWED.includes(to)) {
      throw new CrmError('VALIDATION_FAILED', '알 수 없는 견적 상태입니다.', { field: 'to', got: body.to })
    }
    const quote = await transitQuote(session.workspaceId, session.memberId, params.id, {
      version, to,
      syncDealAmount: body.syncDealAmount === undefined ? undefined : body.syncDealAmount === true,
    })
    return toQuoteJson(quote)
  })
}
