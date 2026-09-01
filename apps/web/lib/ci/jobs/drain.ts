// lib/ci/jobs/drain.ts — 큐를 한 번 돌리는 단일 구현 (서버 전용)
//
// 왜 SSOT인가: 큐를 돌리는 주체가 셋이다 — 브라우저(주 경로) · 크론 백스톱 · 서비스 토큰 워커.
// 셋이 각자 "회수 → 스냅샷 → 임대 → 실행" 순서를 복붙하면 한 곳만 고쳐도 나머지가 어긋난다.
// (재사용·단일구현 정책) 세 호출처는 이 함수를 부르고 예산과 경계만 다르게 준다.
//
// 순서에 이유가 있다:
//   1) 좀비 회수  — 먼저 하지 않으면 막힌 큐를 못 뚫는다
//   2) 스냅샷 예약 — 때가 된 재수집을 큐에 올려야 이번 회차에 함께 처리된다
//   3) 잡 실행     — 예산 안에서 작게 여러 번 집는다

import {
  claimJobs, startRun, finishJob, releaseJob, recoverStalledJobs, countPendingJobs,
} from './queue.ts'
import { runJob } from './handlers.ts'
import { runDueSnapshots, SNAPSHOT_DUE_MAX_PER_TICK } from './snapshot.ts'
import { runDueChannelSweeps, SWEEP_DUE_MAX_PER_TICK } from './channel-sweep.ts'
import { runDueSignalSweeps, SIGNAL_SWEEP_MAX_PER_TICK } from './signals-sweep.ts'
import {
  STALE_LOCK_MS, RECOVER_MAX_PER_PASS, CLAIM_BATCH,
  WEB_DRAIN_LIMIT, WEB_DRAIN_BUDGET_MS,
} from './drain-policy.ts'

export interface DrainOptions {
  /** 주면 그 워크스페이스만. 생략하면 전역(크론·토큰 워커). */
  workspaceId?: string | null
  /** 이번 회차에 실행할 잡 상한. */
  limit?: number
  /** 이번 회차의 시간 예산(ms). 넘으면 더 집지 않고 반환한다. */
  budgetMs?: number
  /** 잠금 소유자 접두사 — 누가 돌렸는지 ci_jobs.locked_by에 남는다. */
  workerPrefix?: string
}

export interface DrainResult {
  /** 회수한 좀비 잡 수 */
  recovered: number
  snapshotsDue: number
  snapshotsEnqueued: number
  /** 다시 훑을 때가 된 관심 채널 수 */
  sweepsDue: number
  sweepsEnqueued: number
  /** 이슈를 다시 훑을 때가 된 워크스페이스 수 */
  signalSweepsDue: number
  signalSweepsEnqueued: number
  claimed: number
  succeeded: number
  failed: number
  dead: number
  /** 이 워커가 모르는 단계라 손대지 않고 돌려둔 잡 수 (실패가 아니다) */
  released: number
  /** 아직 처리를 기다리는 잡 수 — 브라우저가 "더 돌릴지"를 이 값으로 정한다 */
  remaining: number
  /** 예산이 모자라 남기고 반환했는가 */
  budgetExhausted: boolean
}

function workerId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 큐를 한 번 돌린다.
 *
 * **집은 잡은 반드시 실행한다.** 예산 확인은 배치 사이에서만 한다 —
 * 집어놓고 실행하지 않으면 그 잡은 running으로 남아 좀비가 되고,
 * 그걸 되돌리려면 시도 횟수를 되감아야 하는데 그건 재시도 규약을 망가뜨린다.
 * 그래서 배치를 작게(CLAIM_BATCH) 잡는다 — 예산을 넘겨도 잡 하나 길이만큼만 넘는다.
 *
 * 잡 하나가 예산보다 오래 걸릴 수 있다(예: 채널 544건 일괄 수집).
 * 그때 함수가 강제 종료되면 그 잡은 running으로 남지만, 다음 회차의 좀비 회수가 되살린다.
 * 즉 **끊겨도 스스로 낫는다** — 이것이 회수 장치를 먼저 만든 이유다.
 */
export async function drainQueue(options: DrainOptions = {}): Promise<DrainResult> {
  const limit = options.limit ?? WEB_DRAIN_LIMIT
  const budgetMs = options.budgetMs ?? WEB_DRAIN_BUDGET_MS
  const ws = options.workspaceId ?? null
  const startedAt = Date.now()

  const result: DrainResult = {
    recovered: 0,
    snapshotsDue: 0,
    snapshotsEnqueued: 0,
    sweepsDue: 0,
    sweepsEnqueued: 0,
    signalSweepsDue: 0,
    signalSweepsEnqueued: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    released: 0,
    remaining: 0,
    budgetExhausted: false,
  }

  // 1) 끊긴 실행을 되살린다. 이걸 먼저 하지 않으면 막힌 큐를 영원히 못 뚫는다.
  result.recovered = await recoverStalledJobs({
    staleMs: STALE_LOCK_MS,
    limit: RECOVER_MAX_PER_PASS,
    workspaceId: ws,
  })

  // 2) 때가 된 지표 재촬영을 큐에 올린다. 예약만 있고 아무도 읽지 않으면
  //    자동 업데이트는 영원히 오지 않고 속도(velocity)가 null로 굳는다.
  const snapshots = await runDueSnapshots(SNAPSHOT_DUE_MAX_PER_TICK, ws)
  result.snapshotsDue = snapshots.due
  result.snapshotsEnqueued = snapshots.enqueued

  // 2-2) 지켜보는 계정을 주기적으로 다시 훑는다.
  //      이게 없으면 "지켜보기"는 등록 시점 한 번이 전부라, 그 뒤 올라온 게시물을
  //      시스템이 영원히 모른다 — 모니터링이라는 이름만 남는다.
  const sweeps = await runDueChannelSweeps(SWEEP_DUE_MAX_PER_TICK, ws)
  result.sweepsDue = sweeps.due
  result.sweepsEnqueued = sweeps.enqueued

  // 2-3) 바깥 웹을 주기적으로 훑어 이슈 후보를 담는다.
  //      이게 없으면 「이슈」 탭은 사람이 손으로 적는 메모장으로 남는다 —
  //      실측 2026-08-31 기준 이슈 1건, 같은 시점 게시물 1,709건이었다.
  const signalSweeps = await runDueSignalSweeps(SIGNAL_SWEEP_MAX_PER_TICK, ws)
  result.signalSweepsDue = signalSweeps.due
  result.signalSweepsEnqueued = signalSweeps.enqueued

  // 3) 예산 안에서 작게 여러 번 집어 실행한다.
  const prefix = options.workerPrefix ?? (ws ? 'web' : 'srv')
  while (result.claimed < limit) {
    if (Date.now() - startedAt >= budgetMs) {
      result.budgetExhausted = true
      break
    }

    const batch = Math.min(CLAIM_BATCH, limit - result.claimed)
    const jobs = await claimJobs(batch, workerId(prefix), ws)
    if (jobs.length === 0) break

    for (const job of jobs) {
      result.claimed += 1
      const jobStartedAt = Date.now()
      const runId = await startRun(job.id, job.attempt)

      let outcome: { ok: boolean; errorCode?: string; errorMessage?: string; unsupported?: boolean }
      try {
        outcome = await runJob(job)
      } catch (e) {
        outcome = {
          ok: false,
          errorCode: 'INTERNAL',
          errorMessage: e instanceof Error ? e.message : '알 수 없는 오류',
        }
      }

      // 모르는 단계면 시도 횟수를 태우지 않고 돌려둔다 — 아는 워커가 다음에 집는다
      if (outcome.unsupported) {
        await releaseJob(job.id, runId)
        result.released += 1
        continue
      }

      const finalStatus = await finishJob({
        jobId: job.id,
        runId,
        attempt: job.attempt,
        maxAttempts: job.max_attempts,
        status: outcome.ok ? 'succeeded' : 'failed',
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        durationMs: Date.now() - jobStartedAt,
      })

      if (finalStatus === 'succeeded') result.succeeded += 1
      else if (finalStatus === 'dead') result.dead += 1
      else result.failed += 1
    }
  }

  result.remaining = await countPendingJobs(ws)
  return result
}
