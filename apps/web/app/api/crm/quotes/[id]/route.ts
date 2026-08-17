// GET    /api/crm/quotes/[id] — 견적 + 항목
// PATCH  /api/crm/quotes/[id] — 수정 (항목을 주면 통째로 맞춘다)
// DELETE /api/crm/quotes/[id] — 휴지통(기본) 또는 완전 삭제
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import {
  getQuote, updateQuote, deleteQuote, toQuoteJson, type UpdateQuoteInput,
} from '@/lib/crm/services/quote'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => toQuoteJson(await getQuote(db, params.id)))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const quote = await updateQuote(session.workspaceId, session.memberId, params.id,
      { ...body, version } as unknown as UpdateQuoteInput)
    return toQuoteJson(quote)
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const mode = new URL(req.url).searchParams.get('mode') === 'purge' ? 'purge' : 'trash'
    await deleteQuote(session.workspaceId, session.memberId, params.id, mode)
    return { ok: true, mode }
  })
}
