/**
 * 「미팅 끝내기」 잡 — 큐 판정 SSOT (마이그 254)
 *
 * ## 왜 잡인가 (실측 2026-09-14)
 *
 * 끝내기는 POST 하나가 정리와 5축을 잇달아 돌렸다. 그 한 번이 300초 상한에 걸려
 * 295초에 정리만 저장하고 죽었고, 5축은 `crm_ai_run` 에 행 하나 없이 사라졌다.
 * 화면을 나가면 진행도 결과도 통째로 없어졌고, 다시 눌러도 막는 것이 없었다.
 *
 * 응답 뒤에 계속 도는 방법은 이 저장소에 없다 — Next 14.2 에 `after()` 가 없어
 * `void doWork()` 는 인스턴스 동결로 잘린다(`app/api/ci/queue/drain/route.ts`).
 * 그래서 일을 **다음 실행**으로 넘긴다. 이 파일은 그 넘김의 규칙만 갖는다.
 *
 * ## 순수 판정과 DB 를 나누는 이유
 *
 * 단계 전이·임대 만료·재시도 상한은 «지금 몇 시인가»와 «행이 어떤 상태인가»만으로 정해진다.
 * 그 산수를 DB 밖으로 빼 두면 Supabase 없이 그대로 재현된다(정책 E-6).
 */

import type { FinishStep } from '../services/meeting-finish.ts'

/** 잡이 지나가는 단계. **순서가 계약이다** — 정리가 5축보다 먼저다 */
export const FINISH_STAGES = ['DIGEST', 'NOTE', 'EXTRACT', 'DONE'] as const
export type FinishStage = (typeof FINISH_STAGES)[number]

export type FinishJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'

export interface FinishJob {
  id: string
  meetingId: string
  workspaceId: string
  actorId: string | null
  hostUserId: string | null
  status: FinishJobStatus
  stage: FinishStage
  steps: FinishStep[]
  error: string | null
  retryCount: number
  claimedAt: string | null
  createdAt: string
  finishedAt: string | null
}

/** 한 워커가 잡을 쥐고 있을 수 있는 시간. 넘으면 좀비로 보고 다시 집는다 */
export const LEASE_MS = 300_000

/** 같은 잡을 이만큼 시도하고도 안 되면 실패로 못 박는다 — QUEUED 로 두면 화면이 영원히 기다린다 */
export const MAX_ATTEMPTS = 3

/**
 * 이 잡이 아직 일이 남았나.
 *
 * 화면은 이 값으로 버튼을 잠그고 「정리 중」을 띄운다 — 그래서 «끝났는지»를
 * 화면이 제 나름으로 따지지 않게 한 곳에 둔다.
 */
export function isOpen(job: Pick<FinishJob, 'status'>): boolean {
  return job.status === 'QUEUED' || job.status === 'RUNNING'
}

/** 다음 단계. `DONE` 다음은 없다 */
export function nextStage(stage: FinishStage): FinishStage {
  const i = FINISH_STAGES.indexOf(stage)
  return i < 0 || i >= FINISH_STAGES.length - 1 ? 'DONE' : FINISH_STAGES[i + 1]
}

/**
 * 지금 이 잡을 집어도 되나.
 *
 * 집을 수 있는 둘: 아직 아무도 안 집은 것(`QUEUED`), 그리고 집어 간 워커가
 * 임대 시간 안에 돌아오지 않은 것. 둘째가 없으면 워커가 한 번 죽는 순간
 * 그 회의는 영원히 「정리 중」에 갇힌다.
 */
export function isClaimable(
  job: Pick<FinishJob, 'status' | 'claimedAt' | 'retryCount'>,
  nowMs: number,
  leaseMs: number = LEASE_MS,
  maxAttempts: number = MAX_ATTEMPTS,
): boolean {
  if (job.retryCount >= maxAttempts) return false
  if (job.status === 'QUEUED') return true
  if (job.status !== 'RUNNING' || !job.claimedAt) return false
  return nowMs - Date.parse(job.claimedAt) >= leaseMs
}

/**
 * 단계 결과를 덧붙인다 — **같은 단계를 두 번 적지 않는다.**
 *
 * 임대가 끊겨 다시 집힌 잡은 같은 단계를 다시 돌 수 있다. 그때 결과를 그냥 밀어 넣으면
 * 화면에 「정리했어요」가 두 줄로 뜬다. 사용자는 두 번 정리된 줄 안다.
 */
export function mergeSteps(prev: FinishStep[], next: FinishStep[]): FinishStep[] {
  const out = [...prev]
  for (const step of next) {
    const at = out.findIndex((s) => s.key === step.key)
    if (at >= 0) out[at] = step
    else out.push(step)
  }
  return out
}

/**
 * 끝내기가 아직 안 끝났다고 화면에 말할 것인가.
 *
 * 새로 만든 잡과 이미 도는 잡을 화면이 구분할 필요는 없다 — 둘 다 「정리 중」이다.
 * 구분해야 하는 것은 **두 번째 누름이 새 잡을 만들지 않았다**는 사실이고,
 * 그건 부분 유니크 인덱스가 DB 에서 지킨다(마이그 254 `idx_finish_job_one_open`).
 */
export function finishJobView(job: FinishJob | null): {
  running: boolean
  stage: FinishStage | null
  steps: FinishStep[]
  error: string | null
} {
  if (!job) return { running: false, stage: null, steps: [], error: null }
  return {
    running: isOpen(job),
    stage: job.stage,
    steps: job.steps,
    error: job.status === 'FAILED' ? (job.error ?? '정리하지 못했어요.') : null,
  }
}

/** DB 행(스네이크) → 잡. 화면과 드레인이 같은 모양을 본다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toFinishJob(row: any): FinishJob {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    workspaceId: String(row.workspace_id),
    actorId: row.actor_id ?? null,
    hostUserId: row.host_user_id ?? null,
    status: row.status as FinishJobStatus,
    stage: row.stage as FinishStage,
    steps: Array.isArray(row.steps) ? (row.steps as FinishStep[]) : [],
    error: row.error ?? null,
    retryCount: Number(row.retry_count ?? 0),
    claimedAt: row.claimed_at ?? null,
    createdAt: String(row.created_at),
    finishedAt: row.finished_at ?? null,
  }
}
