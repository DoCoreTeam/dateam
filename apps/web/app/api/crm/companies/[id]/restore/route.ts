// POST /api/crm/companies/[id]/restore — 휴지통에서 되살리기
//
// 화면이 "30일 안에 되돌릴 수 있습니다"라고 약속했으므로 되돌릴 길이 반드시 있어야 한다.
// 서비스만 있고 API 가 없으면 그 약속은 화면에서 지켜지지 않는다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { restoreCompany } from '@/lib/crm/services/company'

type Ctx = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) =>
    restoreCompany(session.workspaceId, session.memberId, params.id))
}
