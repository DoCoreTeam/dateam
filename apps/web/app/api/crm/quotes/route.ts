// GET  /api/crm/quotes?dealId=… — 딜 하나의 견적 목록 (전부, 커서 없음)
// GET  /api/crm/quotes          — 워크스페이스 전체 견적 목록 (커서·검색·상태)
// POST /api/crm/quotes          — 견적 생성 (항목을 함께 보낼 수 있다)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import {
  listQuotesByDeal, listQuotes, createQuote, toQuoteJson, type CreateQuoteInput,
} from '@/lib/crm/services/quote'
import { readQuoteValidDays } from '@/lib/crm/services/setting'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const sp = new URL(req.url).searchParams
    const trash = sp.get('trash') === '1'
    const dealId = sp.get('dealId')

    // 딜 상세 안에서 부를 때 — 그 딜 것만, 페이지 없이
    if (dealId) {
      const items = await listQuotesByDeal(db, dealId, { trash })
      // 새 견적의 기본 유효기간도 함께 준다 — 화면이 30일을 자기 코드에 박지 않게
      return { items: items.map(toQuoteJson), defaultValidDays: await readQuoteValidDays(db) }
    }

    /**
     * 딜을 안 주면 워크스페이스 전체다.
     *
     * 예전엔 여기서 거절했다("어느 딜의 견적인지 알려 주세요") — 훑는 화면이 없었기 때문이다.
     * 이제 /crm/quotes 가 그 화면이라 문을 연다. 다만 **반드시 커서·상한이 붙는다**
     * (readListQuery 가 limit 을 20/최대 100 으로 조인다) — 무한 조회는 열지 않는다.
     */
    const { cursor, limit, q } = readListQuery(req)
    const page = await listQuotes(db, { cursor, limit, q, trash, status: sp.get('status') })
    return {
      ...page,
      items: page.items.map((row) => ({
        ...toQuoteJson(row),
        dealName: row.dealName,
        companyName: row.companyName,
      })),
    }
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
