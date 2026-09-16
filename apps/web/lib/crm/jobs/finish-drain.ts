/**
 * 「미팅 끝내기」 잡 드레인 — **한 회차가 한 단계만 진행한다.**
 *
 * ## 왜 한 단계씩인가 (실측 2026-09-14)
 *
 * 예전엔 한 번의 요청이 정리와 5축을 잇달아 돌렸다. 295초에 정리가 저장되고 300초 상한에
 * 잘렸는데, 그때 5축은 모델을 부르던 중이라 `crm_ai_run` 에 행 하나 남기지 못했다 —
 * 실패했다는 사실 자체가 어디에도 없었다. 사용자는 정리가 됐다는 것도 못 봤다.
 *
 * 단계마다 저장하면 어디서 끊겨도 **거기까지는 남는다.** 그리고 다음 회차가 그 다음 단계부터
 * 이어 간다. 상한을 올려서 푸는 문제가 아니다 — 회의가 길어지면 어떤 상한이든 다시 만난다.
 *
 * ## 누가 부르나
 *
 * 둘이다. 화면을 보고 있으면 브라우저가 짧게 반복해 때리고(크론보다 촘촘하다),
 * 화면을 닫으면 크론이 백스톱으로 집는다. 응답 뒤 실행을 보장할 방법이 이 저장소에
 * 없기 때문이다 — Next 14.2 에 `after()` 가 없어 `void doWork()` 는 인스턴스 동결로
 * 잘린다(`app/api/ci/queue/drain/route.ts` 에 그 경위가 적혀 있다).
 */

import { CrmError } from '../domain/errors.ts'
import { getCrmDb } from '../db/client.ts'
import { updateMeeting, extractFiveAxis } from '../services/meeting.ts'
import {
  FINISH_STEP_TEXT as T, digestDetail, extractDetail,
  type FinishStep,
} from '../services/meeting-finish.ts'
import type { AiAdapter } from '../ai/runner.ts'
import {
  isOpen, nextStage, mergeSteps, toFinishJob, LEASE_MS, MAX_ATTEMPTS,
  type FinishJob, type FinishStage,
} from './finish-queue.ts'

/** 정리는 호스트 쪽 모듈이라 주입받는다 — 그래야 이 파일을 그대로 검증할 수 있다 */
export type DigestRunner = (noteId: string, hostUserId: string | null) => Promise<{ agendaCount: number }>
export type NoteConfirmer = (noteId: string) => Promise<boolean>

export interface DrainDeps {
  /**
   * 워크스페이스마다 다른 모델을 쓸 수 있으므로 **잡을 집은 뒤에** 만든다.
   * 미리 하나 만들어 두면 남의 워크스페이스 설정으로 남의 회의를 읽게 된다.
   */
  adapterFor: (workspaceId: string) => Promise<AiAdapter>
  digest: DigestRunner
  confirmNote: NoteConfirmer
  /** 이 시간이 지나면 다음 단계를 시작하지 않는다 — 시작해 놓고 잘리면 기록이 안 남는다 */
  deadlineMs: number
}

function why(e: unknown, fallback: string): string {
  if (e instanceof CrmError) return e.message
  if (e instanceof Error && e.message) return e.message
  return fallback
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = any

/**
 * 잡 하나를 만들거나, 이미 도는 것을 돌려준다.
 *
 * **두 번 눌러도 두 번 돌지 않는다.** 그 계약은 여기 `if` 가 아니라 DB 의 부분 유니크
 * 인덱스가 지킨다(마이그 254). 워커가 둘이라 애플리케이션 검사만으로는 틈이 열린다 —
 * 유니크 위반이 돌아오면 그건 실패가 아니라 «이미 있다»는 답이다.
 */
export async function enqueueFinish(admin: Admin, input: {
  meetingId: string
  workspaceId: string
  actorId: string | null
  hostUserId: string | null
}): Promise<{ job: FinishJob; created: boolean }> {
  const { data, error } = await admin
    .from('crm_meeting_finish_job')
    .insert({
      meeting_id: input.meetingId,
      workspace_id: input.workspaceId,
      actor_id: input.actorId,
      host_user_id: input.hostUserId,
    })
    .select('*')
    .maybeSingle()

  if (!error && data) return { job: toFinishJob(data), created: true }

  // 23505 = unique_violation. 이미 도는 잡이 있다는 뜻이다
  const existing = await latestFinishJob(admin, input.meetingId)
  if (existing && isOpen(existing)) return { job: existing, created: false }

  // supabase-js 는 오류를 던지지 않고 반환한다 — 검사하지 않으면 조용히 넘어간다
  throw new CrmError('CONFLICT', why(error, '정리를 시작하지 못했습니다.'))
}

/** 이 미팅의 마지막 잡. 화면이 「정리 중」과 결과를 여기서 읽는다 */
export async function latestFinishJob(admin: Admin, meetingId: string): Promise<FinishJob | null> {
  const { data } = await admin
    .from('crm_meeting_finish_job')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? toFinishJob(data) : null
}

/** 집어 온다 — 고르는 것과 잠그는 것이 한 문장인 SQL 함수에 맡긴다 */
export async function claimFinishJobs(admin: Admin, limit: number): Promise<FinishJob[]> {
  const { data, error } = await admin.rpc('crm_claim_finish_jobs', {
    p_limit: limit,
    p_lease_sec: Math.round(LEASE_MS / 1000),
    p_max_attempts: MAX_ATTEMPTS,
  })
  if (error) throw new CrmError('CONFLICT', why(error, '잡을 가져오지 못했습니다.'))
  return (data ?? []).map(toFinishJob)
}

async function saveProgress(admin: Admin, job: FinishJob, patch: {
  stage?: FinishStage
  steps?: FinishStep[]
  status?: FinishJob['status']
  error?: string | null
}): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.stage) row.stage = patch.stage
  if (patch.steps) row.steps = patch.steps
  if (patch.status) {
    row.status = patch.status
    if (patch.status === 'DONE' || patch.status === 'FAILED') row.finished_at = new Date().toISOString()
  }
  if (patch.error !== undefined) row.error = patch.error
  // 임대를 놓는다 — 다음 회차가 바로 이어받게
  if (patch.status !== 'RUNNING') row.claimed_at = null

  const { error } = await admin.from('crm_meeting_finish_job').update(row).eq('id', job.id)
  if (error) throw new CrmError('CONFLICT', why(error, '진행 상태를 저장하지 못했습니다.'))
}

/**
 * 한 단계를 돌리고 그 결과를 저장한다.
 *
 * **앞 단계가 넘어져도 다음으로 간다.** 정리가 실패해도 5축은 전사만 있으면 돌고,
 * 5축이 실패해도 끝난 시각은 남는다. 한 단계가 넘어졌다고 회의 기록 전체를 잃게 두지 않는다.
 */
export async function runOneStage(
  admin: Admin,
  job: FinishJob,
  deps: DrainDeps,
): Promise<{ stage: FinishStage; steps: FinishStep[]; done: boolean }> {
  const db = getCrmDb(job.workspaceId)

  const meeting = await (db as any).crmMeeting.findFirst({
    where: { id: job.meetingId },
    select: { id: true, endedAt: true, noteId: true },
  }) as { id: string; endedAt: Date | null; noteId: string | null } | null
  if (!meeting) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')

  const steps: FinishStep[] = []

  if (job.stage === 'DIGEST') {
    // 끝난 시각은 첫 회차에 남긴다 — 이미 있으면 덮지 않는다(두 번 눌렀다고 시각이 밀리면 기록이 거짓이 된다)
    if (!meeting.endedAt) {
      try {
        await updateMeeting(job.workspaceId, job.actorId, job.meetingId, { endedAt: new Date().toISOString() })
        steps.push({ key: 'end', status: 'done', detail: T.endDone })
      } catch (e) {
        steps.push({ key: 'end', status: 'failed', detail: why(e, T.endFailed) })
      }
    } else {
      steps.push({ key: 'end', status: 'skipped', detail: T.endSkipped })
    }

    if (!meeting.noteId) {
      steps.push({ key: 'digest', status: 'skipped', detail: T.digestSkipped })
    } else {
      try {
        const out = await deps.digest(meeting.noteId, job.hostUserId)
        steps.push({ key: 'digest', status: 'done', detail: digestDetail(out.agendaCount) })
      } catch (e) {
        steps.push({ key: 'digest', status: 'failed', detail: why(e, T.digestFailed) })
      }
    }
  } else if (job.stage === 'NOTE') {
    if (!meeting.noteId) {
      steps.push({ key: 'note', status: 'skipped', detail: T.noteSkippedNone })
    } else {
      try {
        const changed = await deps.confirmNote(meeting.noteId)
        steps.push(changed
          ? { key: 'note', status: 'done', detail: T.noteDone }
          : { key: 'note', status: 'skipped', detail: T.noteAlready })
      } catch (e) {
        steps.push({ key: 'note', status: 'failed', detail: why(e, T.noteFailed) })
      }
    }
  } else if (job.stage === 'EXTRACT') {
    try {
      const out = await extractFiveAxis(
        job.workspaceId, job.actorId, job.meetingId,
        await deps.adapterFor(job.workspaceId), job.hostUserId ?? undefined,
      )
      const total = Object.values(out.axes).reduce((n, v) => n + v, 0)
      steps.push({
        key: 'extract',
        status: 'done',
        detail: extractDetail(total, out.suggested, out.dropped),
      })
    } catch (e) {
      // "먼저 전사를 넣어 주세요" 는 실패가 아니라 **아직 할 게 없는 것**이다
      const nothingToRead = e instanceof CrmError && e.code === 'VALIDATION_FAILED'
      steps.push({
        key: 'extract',
        status: nothingToRead ? 'skipped' : 'failed',
        detail: why(e, T.extractFailed),
      })
    }
  }

  const stage = nextStage(job.stage)
  const merged = mergeSteps(job.steps, steps)
  const done = stage === 'DONE'

  await saveProgress(admin, { ...job, steps: merged }, {
    stage,
    steps: merged,
    status: done ? 'DONE' : 'RUNNING',
  })

  return { stage, steps: merged, done }
}

export interface DrainResult {
  claimed: number
  advanced: number
  finished: number
  failed: number
}

/**
 * 집을 수 있는 잡을 돌린다.
 *
 * 한 잡이 여러 단계를 남겨 뒀으면 예산이 허락하는 만큼 이어서 돈다 — 화면을 보고 있는
 * 사람에게는 그게 가장 빠르다. 예산이 떨어지면 임대를 놓고 나간다. 다음 회차가 이어받는다.
 */
export async function drainFinishJobs(
  admin: Admin,
  deps: DrainDeps & { limit: number },
): Promise<DrainResult> {
  const out: DrainResult = { claimed: 0, advanced: 0, finished: 0, failed: 0 }

  const jobs = await claimFinishJobs(admin, deps.limit)
  out.claimed = jobs.length

  for (const claimed of jobs) {
    let job = claimed
    while (job.stage !== 'DONE') {
      // **시작해 놓고 잘리면 기록이 안 남는다** — 그게 오늘 사고의 모양이다.
      // 남은 시간이 한 단계를 감당 못 하면 시작하지 않고 임대를 놓는다
      if (Date.now() >= deps.deadlineMs) {
        await saveProgress(admin, job, { status: 'QUEUED' })
        return out
      }
      try {
        const res = await runOneStage(admin, job, deps)
        out.advanced += 1
        if (res.done) { out.finished += 1; break }
        job = { ...job, stage: res.stage, steps: res.steps }
      } catch (e) {
        out.failed += 1
        await saveProgress(admin, job, {
          status: job.retryCount >= MAX_ATTEMPTS ? 'FAILED' : 'QUEUED',
          error: why(e, '정리하지 못했어요.'),
        })
        break
      }
    }
  }

  return out
}
