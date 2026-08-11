import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { runCreativeBacklog, CREATIVE_MAX_PER_PASS } from '@/lib/ci/jobs/stages'

/**
 * "왜 터졌나" 밀린 분석 실행.
 *
 * 평소에는 수집이 돌 때 자동으로 따라오지만, 이미 쌓여 있는 것은 다음 수집을 기다려야 한다.
 * 사용자가 지금 보고 싶을 때 직접 돌릴 수 있게 열어둔다(성공 공식 재계산과 같은 규약).
 */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const result = await runCreativeBacklog(session.workspaceId)
    return ok({
      note: result.errorMessage ?? '새로 분석할 콘텐츠가 없습니다',
      maxPerPass: CREATIVE_MAX_PER_PASS,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
