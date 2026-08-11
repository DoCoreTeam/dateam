import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { runPatterns } from '@/lib/ci/jobs/stages'

/** 성공 공식 재계산. 사용자가 직접 돌릴 수 있게 열어둔다. */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    await runPatterns(session.workspaceId)
    return ok({ recomputed: true })
  } catch (e) {
    return failUnexpected(e)
  }
}
