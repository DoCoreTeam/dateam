// POST /api/crm/quotes/draft — 자연어를 견적 «초안»으로
//
// **저장하지 않는다.** 화면이 이 값을 편집 폼에 얹고, 사람이 고친 뒤에 저장한다(§5-3).
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { draftQuoteFromText, type CurrentLineContext } from '@/lib/crm/services/quote-draft'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req) as { text?: string; currentLines?: unknown }
    /*
      화면이 편집 중인 항목을 함께 보낸다 — 「총액 3억에 맞춰서」는 맞출 대상이 있어야
      성립한다(v0.7.695). 없으면 예전처럼 텍스트만으로 동작한다(추가 전용, M-4).
    */
    const current = Array.isArray(body?.currentLines)
      ? (body.currentLines as CurrentLineContext[]).slice(0, 50)
      : undefined
    return draftQuoteFromText(session.workspaceId, body?.text ?? '', undefined, current)
  })
}
