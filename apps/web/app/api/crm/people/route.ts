// GET  /api/crm/people — 커서 목록 (회사로 좁힐 수 있다)
// POST /api/crm/people — 생성
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import { listPeople, createPerson, type PersonInput } from '@/lib/crm/services/person'
import { loadMyScope, listScopeOf, listTabs, listActiveTab } from '@/lib/crm/services/my-scope'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db, session }) => {
    const { cursor, limit, q } = readListQuery(req)
    const sp = new URL(req.url).searchParams
    const companyId = sp.get('companyId')
    const trash = sp.get('trash') === '1'

    // 범위는 거래처 목록과 같은 규칙이다 (lib/crm/services/my-scope-decide.ts)
    const my = await loadMyScope(db, session.memberId, session.role)
    const { ownerMemberIds } = listScopeOf(my, sp.get('scope'))

    const page = await listPeople(db, { cursor, limit, q, companyId, trash, ownerMemberIds })
    return { ...page, scope: { tabs: listTabs(my), active: listActiveTab(my, sp.get('scope')) } }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return createPerson(session.workspaceId, session.memberId, body as unknown as PersonInput)
  })
}
