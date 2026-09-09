/**
 * 작업 큐 (설계서 3.5.2)
 *
 * ## 왜 얇은가
 *
 * 선점·재시도·되살림은 **전부 SQL 함수**다(마이그레이션 249). 여기서는 그걸 부르고
 * 결과를 타입으로 옮기기만 한다. 애플리케이션이 「골라서 → 갱신」 두 번에 나누면
 * 그 사이에 남이 집어 가고, 그 사고는 부하가 걸릴 때만 난다.
 *
 * ## 실패를 큐로 되돌리는 것과 죽이는 것
 *
 * 상한 안이면 다시 큐로, 넘겼으면 dead 로 둔다. dead 를 다시 큐에 넣으면
 * **같은 실패를 영원히 반복하면서 다른 잡의 자리를 먹는다.**
 */

import type { JobType } from './stages.ts'
import { MAX_STAGE_ATTEMPTS } from './stages.ts'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'dead'

export interface Job {
  id: string
  orgId: string
  caseId: string | null
  jobType: JobType
  payload: Record<string, unknown>
  priority: number
  status: JobStatus
  attempts: number
  lockedBy: string | null
  error: string | null
  dedupeKey: string | null
}

/** DB 행 → 우리 모양. 칸 이름이 바뀌면 여기 한 곳만 고친다 */
export function toJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    caseId: row.case_id === null || row.case_id === undefined ? null : String(row.case_id),
    jobType: row.job_type as JobType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    priority: Number(row.priority ?? 5),
    status: row.status as JobStatus,
    attempts: Number(row.attempts ?? 0),
    lockedBy: row.locked_by === null || row.locked_by === undefined ? null : String(row.locked_by),
    error: row.error === null || row.error === undefined ? null : String(row.error),
    dedupeKey: row.dedupe_key === null || row.dedupe_key === undefined ? null : String(row.dedupe_key),
  }
}

/** supabase-js 의 rpc 만큼만 필요하다 — 테스트가 가짜를 끼울 수 있게 좁게 잡는다 */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

export const CLAIM_FN = 'rfp_claim_jobs'
export const FINISH_FN = 'rfp_finish_job'
export const FAIL_FN = 'rfp_fail_job'
export const REAP_FN = 'rfp_reap_stale_jobs'
export const ENQUEUE_FN = 'rfp_enqueue_job'

/** 워커 이름 — 어느 워커가 집어 갔는지 남긴다. 죽은 워커를 찾을 때 쓴다 */
export function workerName(prefix = 'rfp'): string {
  return `${prefix}-${process.pid}`
}

export interface ClaimOptions {
  limit?: number
  maxAttempts?: number
  jobTypes?: readonly JobType[]
  worker?: string
}

/**
 * 잡을 집어 온다 — 고르는 것과 잠그는 것이 한 문장이다.
 *
 * 아무것도 없으면 빈 배열이다. 그것은 오류가 아니라 «할 일이 없다» 이므로
 * 워커가 로그를 남기지 않는다.
 */
export async function claimJobs(db: RpcClient, opts: ClaimOptions = {}): Promise<Job[]> {
  const { data, error } = await db.rpc(CLAIM_FN, {
    p_worker: opts.worker ?? workerName(),
    p_limit: opts.limit ?? 1,
    p_max_attempts: opts.maxAttempts ?? MAX_STAGE_ATTEMPTS,
    p_job_types: opts.jobTypes ? Array.from(opts.jobTypes) : null,
  })
  if (error) throw new Error(`잡을 집어 오지 못했다: ${describe(error)}`)
  return Array.isArray(data) ? data.map((r) => toJob(r as Record<string, unknown>)) : []
}

/** 끝났다고 표시한다. 이미 끝난 잡을 다시 끝내도 아무 일이 없다 */
export async function finishJob(
  db: RpcClient, jobId: string, progress: Record<string, unknown> = {},
): Promise<Job | null> {
  const { data, error } = await db.rpc(FINISH_FN, { p_job_id: jobId, p_progress: progress })
  if (error) throw new Error(`잡을 끝내지 못했다: ${describe(error)}`)
  return data ? toJob(data as Record<string, unknown>) : null
}

/**
 * 실패를 기록한다.
 *
 * 상한 안이면 다시 큐로, 넘겼으면 dead 다. 어느 쪽인지는 **DB 가 정한다** —
 * 애플리케이션이 정하면 되살아난 잡의 시도 횟수가 반영되지 않는다.
 */
export async function failJob(
  db: RpcClient, jobId: string, message: string, maxAttempts = MAX_STAGE_ATTEMPTS,
): Promise<Job | null> {
  const { data, error } = await db.rpc(FAIL_FN, {
    p_job_id: jobId,
    p_error: message.slice(0, MAX_ERROR_CHARS),
    p_max_attempts: maxAttempts,
  })
  if (error) throw new Error(`실패를 기록하지 못했다: ${describe(error)}`)
  return data ? toJob(data as Record<string, unknown>) : null
}

/** 오류 문구가 길면 잘라 둔다 — 스택 전체를 넣으면 목록 화면이 못 읽는다 */
export const MAX_ERROR_CHARS = 2000

/** 워커가 죽어 잠금만 남은 잡을 되살린다. 몇 건을 되살렸는지 돌려준다 */
export async function reapStaleJobs(db: RpcClient, olderThan = '15 minutes'): Promise<number> {
  const { data, error } = await db.rpc(REAP_FN, {
    p_older_than: olderThan,
    p_max_attempts: MAX_STAGE_ATTEMPTS,
  })
  if (error) throw new Error(`멈춘 잡을 되살리지 못했다: ${describe(error)}`)
  return Number(data ?? 0)
}

export interface EnqueueInput {
  orgId: string
  caseId: string | null
  jobType: JobType
  payload?: Record<string, unknown>
  priority?: number
  dedupeKey?: string | null
}

/** 잡을 넣는다. 같은 dedupeKey 가 살아 있으면 있던 잡을 돌려준다 */
export async function enqueueJob(db: RpcClient, input: EnqueueInput): Promise<Job> {
  const { data, error } = await db.rpc(ENQUEUE_FN, {
    p_org_id: input.orgId,
    p_case_id: input.caseId,
    p_job_type: input.jobType,
    p_payload: input.payload ?? {},
    p_priority: input.priority ?? 5,
    p_dedupe_key: input.dedupeKey ?? null,
  })
  if (error) throw new Error(`잡을 넣지 못했다: ${describe(error)}`)
  if (!data) throw new Error('잡을 넣었는데 결과가 없다')
  return toJob(data as Record<string, unknown>)
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/** 이 잡을 다시 집을 수 있나 — 화면이 「재시도」 버튼을 그릴지 정한다 */
export function isRetriable(job: Job, maxAttempts = MAX_STAGE_ATTEMPTS): boolean {
  return job.status !== 'done' && job.attempts < maxAttempts
}
