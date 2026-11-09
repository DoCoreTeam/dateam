// GET  /api/crm/contract-clauses?status=&key= — 조항 라이브러리 목록
// POST /api/crm/contract-clauses — 새 조항 (버전 1 초안)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listClauses, createClause, type ClauseInput } from '@/lib/crm/services/contract-clause'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  return withCrmApi('READONLY', async ({ db }) => ({
    items: await listClauses(db, { status: sp.get('status') ?? undefined, key: sp.get('key') ?? undefined }),
  }))
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    return createClause(db, session.workspaceId, session.memberId, body as ClauseInput)
  })
}
