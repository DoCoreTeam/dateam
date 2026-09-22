// POST /api/crm/deals/[id]/owner — 딜 담당자를 바꾼다
//
// **관문을 무조건 부르지 않는다.** 「내 담당을 남에게 넘기기」는 담당자 본인이면 되는 일이라
// `owner.reassign` 권한이 필요 없고, 「남의 담당을 건드리기」는 필요하다. 조건이 갈리므로
// 권한을 **값으로 넘기고** 판정은 `owner-decide.ts` 가 한 곳에서 한다.
// 관문 함수를 여기서 부르면 이관까지 막혀서, 휴가 때 아무도 일을 넘기지 못한다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { viewerOf } from '@/lib/crm/auth/capabilities'
import { hasCapability } from '@/lib/crm/security/sensitivity'
import { reassignDealOwner, type CascadeOptions } from '@/lib/crm/services/owner'
import { loadOrgSnapshot } from '@/lib/crm/services/org-snapshot'
import { CrmError } from '@/lib/crm/domain/errors'

type Ctx = { params: Promise<{ id: string }> }

interface Body extends Record<string, unknown> {
  ownerId?: unknown
  cascade?: CascadeOptions
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req) as Body
    const version = requireVersion(body)
    const nextOwnerMemberId = typeof body.ownerId === 'string' ? body.ownerId.trim() : ''
    if (!nextOwnerMemberId) {
      // 담당자는 비울 수 없다 — 비우면 그 행은 누구의 목록에도 안 뜬다
      throw new CrmError('VALIDATION_FAILED', '새 담당자를 골라 주세요.', { field: 'ownerId' })
    }

    const viewer = await viewerOf(db, session)
    return reassignDealOwner(session.workspaceId, session.memberId, {
      dealId: (await params).id,
      version,
      nextOwnerMemberId,
      canReassign: hasCapability(viewer, 'owner.reassign'),
      org: await loadOrgSnapshot(),
      cascade: body.cascade,
    })
  })
}
