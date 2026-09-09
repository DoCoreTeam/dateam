// POST /api/rfp/worker/tick — 워커 한 번 돌리기
//
// 화면이 부르는 자리가 아니다. 크론과 외부 스케줄러만 부른다.
// 판정은 `lib/crm/jobs/machine-auth` 한 곳이 한다 — 입구마다 각자 비교하면
// 한쪽만 잠그게 되고, 실제로 그 사고가 이 저장소에서 났다(크론 8시간 403).
//
// 크론이 GET 으로 부르므로 GET 도 연다. 열되 **같은 토큰 판정**을 쓴다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createAdminClient } from '@/lib/supabase/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { claimJobs, finishJob, failJob, reapStaleJobs, workerName, type Job } from '@/lib/rfp/jobs/queue'
import type { JobType } from '@/lib/rfp/jobs/stages'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 한 번에 집어 오는 잡 수. 크게 잡으면 한 틱이 타임아웃을 넘긴다 */
const CLAIM_LIMIT = 3

export async function POST(req: NextRequest) { return tick(req) }
export async function GET(req: NextRequest) { return tick(req) }

async function tick(req: NextRequest) {
  if (machineAuthUnconfigured()) {
    // 토큰이 하나도 없으면 «무인증 통과» 가 아니라 «쓸 수 없음» 이다
    return NextResponse.json({ error: '워커 토큰이 설정되지 않았습니다' }, { status: 500 })
  }
  if (!isMachineCall(req)) {
    return NextResponse.json({ error: '워커 토큰이 필요합니다' }, { status: 401 })
  }

  const db = createAdminClient() as unknown as Parameters<typeof claimJobs>[0]
  const worker = workerName()

  // 죽은 워커가 잡고 있던 것부터 되살린다. 안 하면 그 잡은 영원히 running 이다
  let revived = 0
  try {
    revived = await reapStaleJobs(db)
  } catch {
    // 되살리기 실패가 이번 틱을 막을 이유는 없다
  }

  let jobs: Job[] = []
  try {
    jobs = await claimJobs(db, { limit: CLAIM_LIMIT, worker })
  } catch (e) {
    return NextResponse.json({ error: describe(e) }, { status: 500 })
  }

  const results: { id: string; jobType: JobType; ok: boolean; error?: string }[] = []
  for (const job of jobs) {
    try {
      const progress = await runJob(job)
      await finishJob(db, job.id, progress)
      results.push({ id: job.id, jobType: job.jobType, ok: true })
    } catch (e) {
      const message = describe(e)
      await failJob(db, job.id, message)
      results.push({ id: job.id, jobType: job.jobType, ok: false, error: message })
    }
  }

  return NextResponse.json({ worker, revived, claimed: jobs.length, results })
}

/**
 * 잡 하나를 돈다.
 *
 * 단계별 실제 처리는 뒤 항목에서 붙는다. 지금은 **모르는 종류를 조용히 성공시키지 않는다** —
 * 성공으로 두면 케이스가 다음 단계로 넘어가고, 아무 일도 안 한 채 리포트가 비어 나온다.
 */
async function runJob(job: Job): Promise<Record<string, unknown>> {
  throw new Error(`아직 붙지 않은 단계다: ${job.jobType}`)
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
