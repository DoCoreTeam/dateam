import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { runPatterns, runDiscovery } from '@/lib/ci/jobs/stages'

/**
 * 이 요청은 AI를 여러 번 부른다. 기본 상한(10~15초)이면 **운영에서 매번 중간에 끊긴다**
 * — 그러면 발견이 반쯤 만들어진 채로 사라지고, 화면은 이유를 모른 채 오류만 본다.
 */
export const maxDuration = 300

/** 성공 공식·발견 재계산. 사용자가 직접 돌릴 수 있게 열어둔다. */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    // 화면이 고른 주제만 돌린다. 전체 주제(8개)를 한 요청에 몰면 13분이 넘어
    // 사용자는 멈춘 화면을 보고, 운영에서는 상한에 걸려 통째로 버려진다.
    // 전체 훑기는 워커(/api/ci/internal/worker/discover)의 일이다.
    const url = new URL(req.url)
    const topicId = url.searchParams.get('topicId')

    await runPatterns(session.workspaceId)
    // 발견도 같이 돌린다 — 공식(구)과 발견(신)이 같은 버튼에서 갱신돼야
    // 사용자가 "어느 쪽이 최신인지"를 따로 기억하지 않는다.
    const discovery = await runDiscovery(session.workspaceId,
      topicId ? { topicIds: [topicId] } : undefined)

    // **결과를 삼키지 않는다.** 예전에는 반환값을 버리고 늘 성공으로 답했다 —
    // AI 한도에 걸려 발견이 한 건도 안 만들어진 날에도 화면은 "다시 계산했습니다"라고 말했고,
    // 사용자는 목록이 그대로인 이유를 알 길이 없었다(실측 2026-08-27).
    return ok({
      recomputed: true,
      discoveryOk: discovery.ok,
      // 성공이든 실패든 **무슨 일이 있었는지**를 한 줄로 돌려준다.
      // 성공인데 0건인 경우가 가장 헷갈린다 — 그때도 어디서 끊겼는지 말한다.
      discoveryNotice: discovery.ok
        ? discovery.note ?? null
        : [discovery.errorMessage, discovery.note].filter(Boolean).join(' · '),
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
