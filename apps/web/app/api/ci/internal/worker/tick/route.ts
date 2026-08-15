import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { drainQueue } from '@/lib/ci/jobs/drain'
import { CRON_DRAIN_LIMIT, CRON_DRAIN_BUDGET_MS } from '@/lib/ci/jobs/drain-policy'

export const maxDuration = 60

/**
 * 잡 워커. HTTP로 노출되지만 내부 전용이다.
 * 외부 스케줄러·운영자가 서비스 토큰으로 직접 부른다.
 *
 * 실제 처리는 drainQueue(SSOT)가 한다 — 브라우저 경로·크론 백스톱과 같은 구현을 쓴다.
 * 여기는 인증과 전역 범위 지정만 담당한다.
 *
 * 인증: CI_WORKER_TOKEN. 토큰이 설정되지 않았으면 아예 거부한다 —
 * "설정 안 했으니 통과"는 잡 큐를 외부에 열어주는 것과 같다.
 */
export async function POST(req: Request) {
  const expected = process.env.CI_WORKER_TOKEN
  if (!expected) {
    return fail('INTERNAL', '워커 토큰(CI_WORKER_TOKEN)이 설정되지 않았습니다')
  }
  if (req.headers.get('Authorization') !== `Bearer ${expected}`) {
    return fail('UNAUTHORIZED', '워커 토큰이 올바르지 않습니다')
  }

  try {
    // workspaceId를 주지 않는다 = 전역. 서비스 토큰만 이 범위를 쓴다.
    const result = await drainQueue({
      limit: CRON_DRAIN_LIMIT,
      budgetMs: CRON_DRAIN_BUDGET_MS,
      workerPrefix: 'tok',
    })
    return ok(result)
  } catch (e) {
    return failUnexpected(e)
  }
}
