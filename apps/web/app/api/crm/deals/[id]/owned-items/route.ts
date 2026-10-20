// GET /api/crm/deals/:id/owned-items — 이 딜의 회사가 체결한 계약에서 이미 산 품목
//
// 견적의 「제품으로 채우기」가 부른다. 「ENT 전환 구축」 같은 전환 품목은 STD 를 산 고객만 받는데,
// 그 고객인지를 사람의 기억이 아니라 지난 계약이 답한다. 품목 id 와 근거 한 줄뿐, 금액은 없다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { loadOwnedItemsForDeal } from '@/lib/crm/services/owned-items'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => loadOwnedItemsForDeal(getCrmDb(session.workspaceId), id))
}
