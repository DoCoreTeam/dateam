// 발견 하나의 근거를 읽는다.
//
// 왜 이 라우트가 생겼나: 화면은 "근거 7건 · 채널 4곳"이라는 **숫자만** 보여주고
// 그 7건을 열 수 없었다. 근거는 `ci_discovery_evidence` 에 observation 까지 붙어
// 저장돼 있었는데(실측 43건) 읽는 코드가 한 줄도 없었다.

import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { getDiscoveryEvidence } from '@/lib/ci/queries/discovery-evidence'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const { id } = await ctx.params
    const evidence = await getDiscoveryEvidence(session.workspaceId, id)
    // 남의 워크스페이스 발견 id 를 넣어도 여기서 끊긴다(SSOT 가 workspace 로 조회한다)
    if (!evidence) return fail('NOT_FOUND', '이 발견을 찾을 수 없습니다')

    return ok(evidence)
  } catch (e) {
    return failUnexpected(e)
  }
}
