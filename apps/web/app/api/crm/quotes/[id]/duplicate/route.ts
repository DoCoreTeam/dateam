// POST /api/crm/quotes/[id]/duplicate — 개정본 또는 다른 안 만들기
//
// **보낸 견적은 고칠 수 없다.** 값을 바꾸려면 이 길로 새 문서를 만든다 —
// 그래야 앞 판이 그대로 남고, 둘 사이의 연결(sourceQuoteId)도 남는다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { duplicateQuote, toQuoteJson, type DuplicateQuoteInput } from '@/lib/crm/services/quote'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const made = await duplicateQuote(
      session.workspaceId, session.memberId, params.id,
      body as unknown as DuplicateQuoteInput,
    )
    return toQuoteJson(made)
  })
}
