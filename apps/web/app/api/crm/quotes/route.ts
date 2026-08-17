// GET  /api/crm/quotes?dealId=… — 딜 하나의 견적 목록
// POST /api/crm/quotes          — 견적 생성 (항목을 함께 보낼 수 있다)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import {
  listQuotesByDeal, createQuote, toQuoteJson, type CreateQuoteInput,
} from '@/lib/crm/services/quote'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const sp = new URL(req.url).searchParams
    const dealId = sp.get('dealId')
    if (!dealId) {
      // 워크스페이스 전체 견적을 훑는 화면은 아직 없다.
      // "전부 주세요"를 조용히 허용하면 딜 없는 조회가 늘어난다 — 필요해지면 그때 연다.
      throw new CrmError('VALIDATION_FAILED', '어느 딜의 견적인지 알려 주세요.', { field: 'dealId' })
    }
    const items = await listQuotesByDeal(db, dealId, { trash: sp.get('trash') === '1' })
    return { items: items.map(toQuoteJson) }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const quote = await createQuote(
      session.workspaceId, session.memberId, body as unknown as CreateQuoteInput,
    )
    return toQuoteJson(quote)
  })
}
