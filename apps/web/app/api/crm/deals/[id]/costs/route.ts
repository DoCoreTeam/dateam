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
import { listDealCosts, createDealCost, toCostJson, toTotalsJson } from '@/lib/crm/services/cost'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => {
    if (!hasCapability({ role: session.role }, 'cost.view')) {
      throw new CrmError('FORBIDDEN', '원가는 관리자만 볼 수 있어요.')
    }
    const db = getCrmDb(session.workspaceId)
    return toTotalsJson(await listDealCosts(db, id))
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    if (!hasCapability({ role: session.role }, 'cost.edit')) {
      throw new CrmError('FORBIDDEN', '원가는 관리자만 넣을 수 있어요.')
    }
    const body = await readJson(req)
    const row = await createDealCost(session.workspaceId, session.memberId, id, body as never)
    return toCostJson(row)
  })
}
