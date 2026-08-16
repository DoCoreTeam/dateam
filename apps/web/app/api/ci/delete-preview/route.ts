// app/api/ci/delete-preview/route.ts — "지우면 무엇이 사라지나"
//
// 삭제가 되돌릴 수 없으므로 **누르기 전에** 무엇이 함께 사라지는지 보여 준다.
// 판정은 lib/ci/queries/delete.ts(SSOT)가 하고 여기는 권한만 본다.

import { z } from 'zod'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { previewDelete, type CiDeletableKind } from '@/lib/ci/queries/delete'

const Query = z.object({
  kind: z.enum(['content', 'channel', 'board', 'boardItem', 'idea', 'brief', 'editPlan', 'publication']),
  id: z.string().uuid(),
})

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    // 미리보기도 지울 수 있는 사람만 본다 — 남의 데이터 구성을 훔쳐보는 창구가 되면 안 된다
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const url = new URL(req.url)
    const parsed = Query.safeParse({ kind: url.searchParams.get('kind'), id: url.searchParams.get('id') })
    if (!parsed.success) return fail('VALIDATION_FAILED', '무엇을 지울지 알 수 없습니다')

    const impact = await previewDelete(
      parsed.data.kind as CiDeletableKind, parsed.data.id, session.workspaceId,
    )
    return ok(impact)
  } catch (e) {
    return failUnexpected(e)
  }
}
