// GET  /api/crm/people — 커서 목록 (회사로 좁힐 수 있다)
// POST /api/crm/people — 생성
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import { listPeople, createPerson, type PersonInput } from '@/lib/crm/services/person'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const { cursor, limit, q } = readListQuery(req)
    const companyId = new URL(req.url).searchParams.get('companyId')
    return listPeople(db, { cursor, limit, q, companyId })
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return createPerson(session.workspaceId, session.memberId, body as unknown as PersonInput)
  })
}
