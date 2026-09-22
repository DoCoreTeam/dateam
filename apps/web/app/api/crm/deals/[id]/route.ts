import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { getDeal, updateDeal, deleteDeal, toDealJson, type UpdateDealInput } from '@/lib/crm/services/deal'
import { loadMemberDisplays, toPersonJson } from '@/lib/crm/services/member-display'
import { loadOrgSnapshot } from '@/lib/crm/services/org-snapshot'
import { resolveOwner } from '@/lib/crm/services/owner-fallback'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => {
    const deal = await getDeal(db, (await params).id)
    const members = await loadMemberDisplays(db)

    /**
     * 담당자가 비었거나 그 사람이 나갔으면 **조직 상위가 대행한다.**
     * 값을 박지 않고 여기서 계산하는 이유는 `owner-fallback.ts` 머리에 적혀 있다 —
     * 박으면 실제 배정과 자동 승계를 구분할 수 없고 조직 개편을 안 따라간다.
     */
    const ownerRow = deal.ownerId ? members.get(deal.ownerId) : null
    const resolved = resolveOwner(ownerRow?.hostUserId ?? null, ownerRow?.active ?? false, await loadOrgSnapshot())
    const actingMemberId = resolved.acting && resolved.userId
      ? [...members.values()].find((m) => m.hostUserId === resolved.userId && m.active)?.memberId ?? null
      : null

    return {
      ...toDealJson(deal),
      owner: resolved.acting
        ? toPersonJson(actingMemberId, members)
        : toPersonJson(deal.ownerId, members),
      ownerActing: resolved.acting,
      ownerActingVia: resolved.viaNodeName,
      // 작성자는 **과거 사실**이라 대행이 없다. 나간 사람이어도 그 이름 그대로 남는다
      creator: toPersonJson(deal.createdById, members),
    }
  })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const deal = await updateDeal(session.workspaceId, session.memberId, (await params).id,
      { ...body, version } as unknown as UpdateDealInput)
    return toDealJson(deal)
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const mode = new URL(req.url).searchParams.get('mode') === 'purge' ? 'purge' : 'trash'
    await deleteDeal(session.workspaceId, session.memberId, (await params).id, mode)
    return { ok: true, mode }
  })
}
