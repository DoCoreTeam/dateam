// POST /api/crm/quotes/draft — 자연어를 견적 «초안»으로
//
// **저장하지 않는다.** 화면이 이 값을 편집 폼에 얹고, 사람이 고친 뒤에 저장한다(§5-3).
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { draftQuoteFromText } from '@/lib/crm/services/quote-draft'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req) as { text?: string }
    return draftQuoteFromText(session.workspaceId, body?.text ?? '')
  })
}
