// app/api/ci/queue/progress/route.ts — 큐 진행 상황
//
// 왜 필요한가: 화면이 "수집 중 1,017건 남음"이라고만 말했다. 숫자 하나로는
// **무엇을 하는 중인지도, 언제 끝나는지도, 뭔가 막혔는지도** 알 수 없다.
// 사용자가 그 칩을 눌러 보려 했는데 눌리지도 않았다(지적 2026-08-18).
//
// 판정은 전부 순수 모듈(lib/ci/jobs/progress.ts)이 한다. 여기는 세는 일만 한다.

import { createAdminClient } from '@/lib/supabase/server'
import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import {
  buildQueueProgress, groupFailures, formatEta, type StageCount,
} from '@/lib/ci/jobs/progress'
import type { CiJobStage, CiJobStatus } from '@/lib/ci/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 처리 속도를 재는 창. 짧으면 흔들리고 길면 지금 상태를 못 따라간다. */
const THROUGHPUT_WINDOW_MIN = 10

/** 실패 목록을 훑는 상한. 전부 읽으면 큐가 클 때 느려진다 — 묶어서 보여줄 뿐이다. */
const FAILURE_SCAN_LIMIT = 200

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const adminClient = createAdminClient() as any
    const since = new Date(Date.now() - THROUGHPUT_WINDOW_MIN * 60_000).toISOString()

    const [openRes, failRes, doneRes] = await Promise.all([
      // 아직 끝나지 않은 것 — 단계·상태별로 세려면 행을 봐야 한다(집계 API가 없다)
      adminClient.from('ci_jobs')
        .select('stage, status')
        .eq('workspace_id', session.workspaceId)
        .in('status', ['queued', 'running', 'failed'])
        .limit(20_000),
      // 실패 사유 — 사용자가 "왜 막혔나"를 알 수 있어야 한다
      adminClient.from('ci_jobs')
        .select('stage, status, error_message')
        .eq('workspace_id', session.workspaceId)
        .in('status', ['failed', 'dead'])
        .order('updated_at', { ascending: false })
        .limit(FAILURE_SCAN_LIMIT),
      // 최근 완료 — 처리 속도의 근거. 없으면 남은 시간을 말하지 않는다.
      adminClient.from('ci_job_runs')
        .select('duration_ms, ci_jobs!inner(workspace_id)')
        .eq('ci_jobs.workspace_id', session.workspaceId)
        .eq('status', 'succeeded')
        .gte('finished_at', since)
        .limit(2_000),
    ])

    const openRows = (openRes.data ?? []) as { stage: CiJobStage; status: CiJobStatus }[]
    const byStage = new Map<CiJobStage, StageCount>()
    let dead = 0
    for (const r of openRows) {
      const c = byStage.get(r.stage) ?? { stage: r.stage, waiting: 0, running: 0, failed: 0 }
      if (r.status === 'running') c.running += 1
      else if (r.status === 'failed') c.failed += 1
      else c.waiting += 1
      byStage.set(r.stage, c)
    }

    const failRows = (failRes.data ?? []) as {
      stage: CiJobStage; status: CiJobStatus; error_message: string | null
    }[]
    dead = failRows.filter((r) => r.status === 'dead').length

    const durations = ((doneRes.data ?? []) as { duration_ms: number | null }[])
      .map((r) => r.duration_ms)
      .filter((v): v is number => typeof v === 'number' && v > 0)

    const progress = buildQueueProgress({
      stageCounts: Array.from(byStage.values()),
      dead,
      recentFailures: groupFailures(
        failRows.map((r) => ({ stage: r.stage, message: r.error_message, status: r.status })),
      ),
      recentDurationsMs: durations,
      recentDoneCount: durations.length,
      recentWindowMin: THROUGHPUT_WINDOW_MIN,
    })

    // 남은 시간 문구도 서버가 만든다.
    // ① 화면마다 다른 말이 나오지 않는다 ② 클라이언트가 서버용 모듈(.ts 확장자 import)을
    //    번들에 끌어들이지 않아도 된다 — 그러다 모듈 로드가 깨져 칩이 통째로 사라졌다(실측).
    return ok({ ...progress, etaText: formatEta(progress.etaMinutes) })
  } catch (e) {
    return failUnexpected(e)
  }
}
