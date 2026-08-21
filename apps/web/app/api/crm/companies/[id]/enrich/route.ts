// POST /api/crm/companies/[id]/enrich — 이 회사 하나를 웹에서 찾아 빈 칸을 채운다
//
// 쓰기 경로다(빈 칸이 실제로 채워질 수 있다) — READONLY 는 부를 수 없다.
import type { NextRequest } from 'next/server'

/** 한 곳이라도 웹검색 AI 는 실측 15~30초다. 기본 상한으로는 끊긴다(v0.7.574). */
export const maxDuration = 60
import { withCrmApi } from '@/lib/crm/api/handler'
import { adapterFromSetting } from '@/lib/crm/services/quick-create'
import { enrichCompanyFromWeb } from '@/lib/crm/services/enrich-web'

type Ctx = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    // 웹 검색을 못 하는 프로바이더면 어댑터가 여기서 분명히 실패한다 —
    // 기억으로 답한 값을 "찾았다"고 보여 주지 않기 위해서다(host.ts).
    const adapter = await adapterFromSetting(db, { webSearch: true })
    return enrichCompanyFromWeb(db, session.workspaceId, session.memberId, params.id, adapter)
  })
}
