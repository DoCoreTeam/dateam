// PATCH  /api/crm/costs/:id — 원가 항목 고치기
// DELETE /api/crm/costs/:id — 지우기
//
// **소프트 삭제가 아니다.** 원가 항목은 «우리 추정»이라 잘못 넣으면 지우는 것이 맞다 —
// 남겨 두면 합계가 틀리고, 틀린 합계로 마진을 판단하면 그게 더 위험하다.
// 대신 감사 로그에 무엇을 지웠는지 남는다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { hasCapability } from '@/lib/crm/security/sensitivity'
import { updateDealCost, deleteDealCost, toCostJson } from '@/lib/crm/services/cost'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    if (!hasCapability({ role: session.role }, 'cost.edit')) {
      throw new CrmError('FORBIDDEN', '원가는 관리자만 고칠 수 있어요.')
    }
    const body = await readJson(req)
    return toCostJson(await updateDealCost(session.workspaceId, session.memberId, id, body as never))
  })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    if (!hasCapability({ role: session.role }, 'cost.edit')) {
      throw new CrmError('FORBIDDEN', '원가는 관리자만 지울 수 있어요.')
    }
    await deleteDealCost(session.workspaceId, session.memberId, id)
    return { ok: true }
  })
}
