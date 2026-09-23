// GET  /api/crm/companies  — 커서 목록
// POST /api/crm/companies  — 생성
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import { listCompanies, createCompany, type CompanyInput } from '@/lib/crm/services/company'
import { loadMyScope, listScopeOf, listTabs, listActiveTab } from '@/lib/crm/services/my-scope'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db, session }) => {
    const { cursor, limit, q } = readListQuery(req)
    const sp = new URL(req.url).searchParams
    const trash = sp.get('trash') === '1'

    /*
      목록의 범위 — 누구 것을 볼 것인가.
      기본은 **내 담당**이고, 넓히는 탭은 서버가 실어 보낸 것만 받는다.
      화면이 보내는 것은 탭 이름뿐이라 남의 id 를 실어 범위를 넓히는 길이 없다.
    */
    const my = await loadMyScope(db, session.memberId, session.role)
    const { ownerMemberIds } = listScopeOf(my, sp.get('scope'))

    const page = await listCompanies(db, { cursor, limit, q, trash, ownerMemberIds })
    return { ...page, scope: { tabs: listTabs(my), active: listActiveTab(my, sp.get('scope')) } }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return createCompany(session.workspaceId, session.memberId, body as unknown as CompanyInput)
  })
}
