import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { claimJobs, startRun, finishJob } from '@/lib/ci/jobs/queue'
import { runJob } from '@/lib/ci/jobs/handlers'

/** 한 번의 tick에서 처리할 잡 수 — 서버리스 타임아웃 안에 끝나야 한다 */
const BATCH = 10

export const maxDuration = 60

/**
 * 잡 워커. HTTP로 노출되지만 내부 전용이다.
 * 크론이나 큐 서비스가 주기적으로 때린다.
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
    const workerId = `w-${Math.random().toString(36).slice(2, 10)}`
    const jobs = await claimJobs(BATCH, workerId)

    let succeeded = 0
    let failed = 0
    let dead = 0

    for (const job of jobs) {
      const startedAt = Date.now()
      const runId = await startRun(job.id, job.attempt)

      let result: { ok: boolean; errorCode?: string; errorMessage?: string }
      try {
        result = await runJob(job)
      } catch (e) {
        result = {
          ok: false,
          errorCode: 'INTERNAL',
          errorMessage: e instanceof Error ? e.message : '알 수 없는 오류',
        }
      }

      const finalStatus = await finishJob({
        jobId: job.id,
        runId,
        attempt: job.attempt,
        maxAttempts: job.max_attempts,
        status: result.ok ? 'succeeded' : 'failed',
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        durationMs: Date.now() - startedAt,
      })

      if (finalStatus === 'succeeded') succeeded++
      else if (finalStatus === 'dead') dead++
      else failed++
    }

    return ok({ claimed: jobs.length, succeeded, failed, dead })
  } catch (e) {
    return failUnexpected(e)
  }
}
