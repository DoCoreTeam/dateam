// GET  /api/crm/quote-terms — 거래 조건 목록 (?dealBusinessType= 로 그 유형에 맞는 것만)
// POST /api/crm/quote-terms — 조건 추가
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listQuoteTerms, listQuoteTermsFor, createQuoteTerm } from '@/lib/crm/services/quote-term'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const forType = new URL(req.url).searchParams.get('businessType')
    const items = forType !== null
      ? await listQuoteTermsFor(db, forType || null)
      : await listQuoteTerms(db)
    return { items }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return createQuoteTerm(session.workspaceId, session.memberId, body)
  })
}
