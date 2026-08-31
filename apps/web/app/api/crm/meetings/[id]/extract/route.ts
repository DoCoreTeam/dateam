// POST /api/crm/meetings/:id/extract — 전사에서 5축을 뽑아 인박스로 보낸다
//
// 이 라우트가 없어서 **5축이 구조적으로 발동할 수 없었다**(명세가 정한 트리거가 여기다).
// AI 가 읽어낸 것은 전부 제안으로 간다 — 코어 테이블에 직접 쓰지 않는다(절대규칙 1).
//
// 어느 모델을 쓸지는 `adapterFromSetting` 하나만 안다. 예전엔 이 라우트가 같은 판단을
// 손으로 다시 했는데, 그러면 설정을 바꿔도 한쪽만 따라가고 **같은 워크스페이스가 두 모델을 쓴다**.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { extractFiveAxis } from '@/lib/crm/services/meeting'
import { adapterFromSetting } from '@/lib/crm/services/quick-create'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)

    /**
     * `hostUserId` 를 넘기면 **읽을 것이 없을 때 원본 본문을 재료로 끌어온다.**
     *
     * 그 폴백은 `extractFiveAxis` **안**에 있다 — 이 라우트에만 두면
     * 「미팅 끝내기」(`/finish`)가 같은 함수를 직접 불러 주 경로를 지나가지 않는다(실측 v0.7.666).
     */
    return extractFiveAxis(
      session.workspaceId, session.memberId, id, await adapterFromSetting(db), session.hostUserId,
    )
  })
}
