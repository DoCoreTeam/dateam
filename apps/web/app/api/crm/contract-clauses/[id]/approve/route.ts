// POST /api/crm/contract-clauses/[id]/approve — 초안 승인 (관리자, version 필요). 서비스가 역할을 다시 본다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { approveClause } from '@/lib/crm/services/contract-clause'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ db, session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return approveClause(db, session.workspaceId, session.memberId, (await params).id, version)
  })
}
