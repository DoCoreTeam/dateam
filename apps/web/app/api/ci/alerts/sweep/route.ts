import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { runAlertBacklog } from '@/lib/ci/alerts/evaluate'
import { ALERT_MAX_PER_PASS } from '@/lib/ci/alerts/rules'

const SKIP_NOTE: Record<string, string> = {
  quiet_hours: '방해 금지 시간이라 지금은 보내지 않았습니다. 시간이 지나면 자동으로 전달됩니다',
  no_candidates: '새로 알릴 떡상이 없습니다',
  no_members: '알림을 받을 멤버가 없습니다',
}

/**
 * 떡상 알림 재훑기 실행.
 *
 * 평소에는 수집이 돌 때 파생값 계산에 이어 자동으로 따라온다.
 * 이미 쌓여 있는 것은 다음 수집을 기다려야 하므로, 지금 확인하고 싶을 때 직접 돌릴 수 있게 연다
 * (성공 공식 재계산·크리에이티브 분석과 같은 규약).
 */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const result = await runAlertBacklog(session.workspaceId)
    // 조회가 깨진 것을 "알릴 게 없다"로 바꿔 말하지 않는다
    if (!result.ok) {
      return fail('INTERNAL', result.errorMessage ?? '떡상 알림을 확인하지 못했습니다')
    }
    return ok({
      created: result.created,
      note: result.created > 0
        ? `알림 ${result.created}건을 보냈습니다`
        : SKIP_NOTE[result.skipped ?? ''] ?? '새로 알릴 떡상이 없습니다',
      maxPerPass: ALERT_MAX_PER_PASS,
      diagnostics: result.diagnostics,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
