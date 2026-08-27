// 검토 대기를 «판정 묶음»으로 읽는다.
//
// 예전에는 화면이 게시물 634줄을 받아 줄마다 물었다. 이제 묶음 몇 장만 받는다.

import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { listReviewGroups } from '@/lib/ci/queries/review-groups'

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const groups = await listReviewGroups(session.workspaceId)
    return ok({ groups })
  } catch (e) {
    return failUnexpected(e)
  }
}
