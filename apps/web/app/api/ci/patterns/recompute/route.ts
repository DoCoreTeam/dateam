import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { runPatterns, runDiscovery } from '@/lib/ci/jobs/stages'

/** 성공 공식 재계산. 사용자가 직접 돌릴 수 있게 열어둔다. */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    await runPatterns(session.workspaceId)
    // 발견도 같이 돌린다 — 공식(구)과 발견(신)이 같은 버튼에서 갱신돼야
    // 사용자가 "어느 쪽이 최신인지"를 따로 기억하지 않는다
    await runDiscovery(session.workspaceId)
    return ok({ recomputed: true })
  } catch (e) {
    return failUnexpected(e)
  }
}
