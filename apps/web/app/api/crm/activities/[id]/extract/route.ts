// POST /api/crm/activities/:id/extract — 남긴 기록에서 5축을 뽑아 인박스로 보낸다
//
// 노트에 적힌 금액·다음 약속·걸림돌이 딜로 옮겨지지 않던 자리다.
// 미팅과 같은 엔진을 쓰되(activity-extract.ts) 코어 테이블에는 직접 쓰지 않는다 — 전부 제안이다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { extractActivityFiveAxis } from '@/lib/crm/services/activity-extract'
import { adapterFromSetting } from '@/lib/crm/services/quick-create'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    return extractActivityFiveAxis(session.workspaceId, session.memberId, id, await adapterFromSetting(db))
  })
}
