// GET  /api/crm/deals — 커서 목록 (보드는 status=OPEN 으로 좁힌다)
// POST /api/crm/deals — 생성
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import { listDeals, createDeal, toDealJson, type DealInput } from '@/lib/crm/services/deal'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const { cursor, limit, q } = readListQuery(req)
    const sp = new URL(req.url).searchParams
    const page = await listDeals(db, {
      cursor, limit, q,
      pipelineId: sp.get('pipelineId'),
      companyId: sp.get('companyId'),
      status: sp.get('status'),
      trash: sp.get('trash') === '1',
    })
    // BigInt 는 JSON 으로 직렬화되지 않는다 — 문자열로 내보낸다
    return { items: page.items.map(toDealJson), nextCursor: page.nextCursor }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const deal = await createDeal(session.workspaceId, session.memberId, body as unknown as DealInput)
    return toDealJson(deal)
  })
}
