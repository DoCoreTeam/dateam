import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { getHomeData } from '@/lib/ci/queries/home-data'

/** 홈은 한 번의 왕복으로 미니맵·브리핑·갱신 상태를 모두 받는다. */
export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    return ok(await getHomeData(session.workspaceId))
  } catch (e) {
    return failUnexpected(e)
  }
}
