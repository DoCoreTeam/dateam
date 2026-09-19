// GET  /api/crm/deals/:id/costs — 이 딜의 원가 + 합계 + 마진
// POST /api/crm/deals/:id/costs — 원가 항목 추가
//
// **원가는 대외비다.** 화면·API·내보내기가 같은 표(`security/sensitivity.ts`)를 읽는데,
// 여기서도 한 번 더 막는다 — 이 응답에는 마진이 들어 있어 새어 나가면 협상력이 사라진다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { CrmError } from '@/lib/crm/domain/errors'
import { hasCapability } from '@/lib/crm/security/sensitivity'
import { listDealCosts, createDealCost, createDealCosts, toCostJson, toTotalsJson } from '@/lib/crm/services/cost'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => {
    if (!hasCapability({ role: session.role }, 'cost.view')) {
      throw new CrmError('FORBIDDEN', '원가는 관리자만 볼 수 있어요.')
    }
    const db = getCrmDb(session.workspaceId)
    /*
      **넣을 수 있는지도 함께 말한다.**

      화면이 「관리자면 보인다」를 자기 코드로 판정하면 규칙이 두 곳이 되고, 나중에 능력을
      사람 단위로 주는 날 화면만 옛 규칙으로 남는다. 그래서 판정은 아래 POST 의 게이트
      한 곳에 두고, 여기서는 **그 게이트의 답을 그대로 전한다** — 이 값으로 아무것도 허락하지 않는다.
    */
    return {
      ...toTotalsJson(await listDealCosts(db, id)),
      canEdit: hasCapability({ role: session.role }, 'cost.edit'),
    }
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    if (!hasCapability({ role: session.role }, 'cost.edit')) {
      throw new CrmError('FORBIDDEN', '원가는 관리자만 넣을 수 있어요.')
    }
    const body = await readJson(req) as Record<string, unknown>
    /*
      **묶음도 같은 문으로 들어온다.** 받은 견적서 한 건은 원가 여러 줄이 되는데,
      그 길에 창구를 따로 내면 게이트가 두 곳이 되고 한쪽만 고쳐지는 날이 온다.
    */
    if (Array.isArray(body.items)) {
      const rows = await createDealCosts(session.workspaceId, session.memberId, id, body.items as never[])
      return { items: rows.map(toCostJson) }
    }
    const row = await createDealCost(session.workspaceId, session.memberId, id, body as never)
    return toCostJson(row)
  })
}
