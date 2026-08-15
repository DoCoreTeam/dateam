// app/api/ci/queue/drain/route.ts — 브라우저가 부르는 큐 드레인 (세션 인증)
//
// 왜 이 입구가 따로 필요한가:
//   기존 워커(/api/ci/internal/worker/tick)는 서비스 토큰을 요구한다. 그 토큰을
//   브라우저에 내려보내면 큐가 외부에 열린다. 그래서 브라우저는 **세션으로** 인증하고,
//   **자기 워크스페이스만** 돌리는 별도 입구를 쓴다.
//   (가드가 이 파일에 서비스 토큰 이름이 등장하는 것 자체를 막는다 — 적어두면 언젠가 복사된다)
//
// 왜 크론이 아니라 브라우저인가(§7-0):
//   Next 14.2에는 after()가 없고 @vercel/functions도 없다. 응답 후 백그라운드 실행을
//   보장할 방법이 없어 `void doWork()`는 인스턴스 동결로 잘린다. 대신 브라우저가
//   짧은 요청을 반복해 때린다 — 의존성 0이고, 화면을 보는 동안 크론보다 촘촘하다.

import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { drainQueue } from '@/lib/ci/jobs/drain'
import { WEB_DRAIN_LIMIT, WEB_DRAIN_BUDGET_MS } from '@/lib/ci/jobs/drain-policy'

/**
 * 잡 하나가 예산보다 오래 걸릴 수 있다(채널 일괄 수집 등). 그때를 위해 넉넉히 두되,
 * 여기서 잘려도 그 잡은 다음 회차의 좀비 회수가 되살린다.
 */
export const maxDuration = 60

/** 같은 워크스페이스가 이 간격 안에 다시 부르면 일하지 않고 즉시 반환한다. */
const MIN_INTERVAL_MS = 1_500

/**
 * 인스턴스 단위 최소 간격(최선 노력).
 *
 * 서버리스라 인스턴스가 여러 개면 완전히 막지는 못한다. 진짜 방어선은 잡 임대가
 * 원자적이라는 것 — 동시에 들어와도 같은 잡을 두 번 실행하지 않는다.
 * 이건 클라이언트 버그로 초당 수십 번 때리는 사고를 싸게 막는 장치다.
 */
const lastRunAt = new Map<string, number>()

function tooSoon(workspaceId: string, now: number): boolean {
  const prev = lastRunAt.get(workspaceId)
  if (prev !== undefined && now - prev < MIN_INTERVAL_MS) return true
  lastRunAt.set(workspaceId, now)
  // 오래된 항목은 버린다 — 워크스페이스가 늘어도 맵이 무한정 자라지 않게
  if (lastRunAt.size > 500) {
    lastRunAt.forEach((at, key) => {
      if (now - at > 60_000) lastRunAt.delete(key)
    })
  }
  return false
}

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    // viewer도 큐를 돌린다 — 드레인은 사용자가 고른 변경이 아니라 시스템 처리이고,
    // "화면을 연 사람이 큐를 굴린다"가 이 설계의 전제다.
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    if (tooSoon(session.workspaceId, Date.now())) {
      return ok({ skipped: 'too_soon' as const, remaining: null })
    }

    const result = await drainQueue({
      workspaceId: session.workspaceId,
      limit: WEB_DRAIN_LIMIT,
      budgetMs: WEB_DRAIN_BUDGET_MS,
      workerPrefix: 'web',
    })

    return ok({ skipped: null, ...result })
  } catch (e) {
    return failUnexpected(e)
  }
}

/** GET은 상태만 본다 — 큐를 돌리지 않는다. */
export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const { countPendingJobs } = await import('@/lib/ci/jobs/queue')
    return ok({ remaining: await countPendingJobs(session.workspaceId) })
  } catch (e) {
    return fail('INTERNAL', e instanceof Error ? e.message : '큐 상태를 읽지 못했습니다')
  }
}
