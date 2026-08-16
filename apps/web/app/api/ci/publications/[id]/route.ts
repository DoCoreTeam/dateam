// app/api/ci/publications/[id]/route.ts — 게시 기록 지우기
// 잘못 등록한 게시물을 목록에서 없앤다. 원본 게시물(플랫폼)은 건드리지 않는다.

import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { deleteCiEntity } from '@/lib/ci/queries/delete'

/** 진짜로 지운다. 되돌릴 수 없다. 플랫폼에 올라간 실제 게시물은 그대로 남는다. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const { id } = await ctx.params
    const res = await deleteCiEntity('publication', id, session.workspaceId)
    if (!res.ok) return fail(res.code ?? 'INTERNAL', res.errorMessage ?? '지우지 못했습니다')
    if (res.deleted === 0) return fail('NOT_FOUND', '게시 기록을 찾을 수 없습니다')
    return ok({ id, deleted: res.deleted })
  } catch (e) {
    return failUnexpected(e)
  }
}
