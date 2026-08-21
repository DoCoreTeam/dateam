// lib/ci/jobs/queue.ts — 잡 큐 (설계서 §11.2)
// 1차 실패 진단: "요청 경로에서 동기 처리, 실패하면 그대로 방치, 재시도와 상태 추적 부재"
// 차단 장치: 모든 정리 작업을 비동기 잡으로 분리, 재시도와 실패 큐, 잡 상태를 화면에 노출.

import { createAdminClient } from '@/lib/supabase/server'
import type { CiJobStage, CiJobStatus } from '../types.ts'
import { MAX_ATTEMPTS, backoffSeconds, idempotencyKey, nextStatusAfterFailure } from './policy.ts'

// 정책은 policy.ts가 SSOT다. 호출처 편의를 위해 재수출한다.
export { MAX_ATTEMPTS, backoffSeconds, idempotencyKey, nextStage } from './policy.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface EnqueueInput {
  workspaceId: string | null
  stage: CiJobStage
  targetType: string
  targetId: string
  payload?: Record<string, unknown>
  version?: number
  delaySeconds?: number
}

export interface EnqueueResult {
  jobId: string | null
  /** 이미 같은 잡이 있어 새로 만들지 않은 경우 */
  deduped: boolean
}

/**
 * 잡을 넣는다. 중복이면 조용히 기존 잡을 돌려준다(에러 아님).
 * 잡 등록 실패가 사용자 저장을 막지 않도록, 호출자는 결과를 확인하되 예외로 흐름을 끊지 않는다.
 */
export async function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  const key = idempotencyKey(input.stage, input.targetId, input.version ?? 1)
  const nextRunAt = new Date(Date.now() + (input.delaySeconds ?? 0) * 1000).toISOString()

  try {
    const adminClient = createAdminClient() as any
    const { data, error } = await adminClient
      .from('ci_jobs')
      .insert({
        workspace_id: input.workspaceId,
        stage: input.stage,
        idempotency_key: key,
        target_type: input.targetType,
        target_id: input.targetId,
        payload: input.payload ?? {},
        status: 'queued',
        next_run_at: nextRunAt,
        max_attempts: MAX_ATTEMPTS,
      })
      .select('id')
      .single()

    if (error) {
      // 유니크 위반 = 이미 같은 잡이 큐에 있다
      const existing = await adminClient
        .from('ci_jobs').select('id').eq('idempotency_key', key).maybeSingle()
      return { jobId: existing.data?.id ?? null, deduped: true }
    }
    return { jobId: data?.id ?? null, deduped: false }
  } catch {
    return { jobId: null, deduped: false }
  }
}

export interface ClaimedJob {
  id: string
  workspace_id: string | null
  /** 이 잡의 멱등키. 다음 단계에 버전을 물려주는 근거다(policy.chainVersionFromKey). */
  idempotency_key: string
  stage: CiJobStage
  target_type: string
  target_id: string | null
  payload: Record<string, unknown>
  attempt: number
  max_attempts: number
}

/**
 * 실행할 잡을 임대한다.
 * 동시에 여러 워커가 돌아도 같은 잡을 두 번 집지 않도록 원자적으로 상태를 바꾼다.
 *
 * `workspaceId`를 주면 그 워크스페이스의 잡만 집는다.
 * 왜 필요한가: 예전에는 서비스 토큰을 가진 크론만 이 함수를 불렀으므로 전역 임대가 무해했다.
 * 브라우저(사용자 세션)가 큐를 돌리게 되면 **남의 워크스페이스 잡을 처리**하게 된다 —
 * 권한 경계 위반이자, 남의 외부 API 쿼터를 내 접속으로 태우는 일이다.
 * 전역 드레인(크론·토큰 워커)은 계속 생략해서 부른다.
 */
export async function claimJobs(
  limit: number,
  workerId: string,
  workspaceId?: string | null,
): Promise<ClaimedJob[]> {
  const adminClient = createAdminClient() as any
  const nowIso = new Date().toISOString()

  let query = adminClient
    .from('ci_jobs')
    .select('id, workspace_id, idempotency_key, stage, target_type, target_id, payload, attempt, max_attempts')
    .in('status', ['queued', 'failed'])
    .lte('next_run_at', nowIso)
  if (workspaceId) query = query.eq('workspace_id', workspaceId)

  const { data: candidates } = await query
    .order('next_run_at', { ascending: true })
    .limit(limit)

  const claimed: ClaimedJob[] = []
  for (const c of (candidates ?? []) as ClaimedJob[]) {
    // 상태를 조건부로 바꾼다 — 다른 워커가 먼저 집었으면 0행이 갱신되고 건너뛴다
    const { data: updated } = await adminClient
      .from('ci_jobs')
      .update({
        status: 'running',
        attempt: c.attempt + 1,
        locked_at: nowIso,
        locked_by: workerId,
        updated_at: nowIso,
      })
      .eq('id', c.id)
      .in('status', ['queued', 'failed'])
      .select('id')
    if (updated && updated.length > 0) claimed.push({ ...c, attempt: c.attempt + 1 })
  }
  return claimed
}

/**
 * 잠금이 만료된 running 잡을 회수한다.
 *
 * 왜 필요한가: `claimJobs`는 queued·failed만 집는다. 실행 중 프로세스가 죽으면
 * 그 잡은 running으로 남아 **아무도 다시 집지 않는다**(영구 좀비). 크론만 워커를 돌리던
 * 시절에는 프로세스가 끝까지 도니 드물었지만, 브라우저가 큐를 돌리면
 * **사용자가 탭을 닫을 때마다** 발생한다. 회수 없이는 큐가 좀비로 막힌다.
 *
 * 회수는 새 상태를 발명하지 않는다 — 실패와 똑같이 취급해 기존 재시도·DLQ 규약을 그대로 탄다.
 * 시도 한도를 이미 쓴 잡은 되살리지 않고 실패 큐로 보낸다(무한 부활 금지).
 */
export async function recoverStalledJobs(input: {
  staleMs: number
  limit: number
  workspaceId?: string | null
}): Promise<number> {
  const adminClient = createAdminClient() as any
  const nowIso = new Date().toISOString()
  const cutoffIso = new Date(Date.now() - input.staleMs).toISOString()

  let query = adminClient
    .from('ci_jobs')
    .select('id, attempt, max_attempts')
    .eq('status', 'running')
    .lt('locked_at', cutoffIso)
  if (input.workspaceId) query = query.eq('workspace_id', input.workspaceId)

  const { data } = await query.limit(input.limit)
  const rows = (data ?? []) as { id: string; attempt: number; max_attempts: number }[]
  if (rows.length === 0) return 0

  // 시도가 남았으면 즉시 재시도(failed), 다 썼으면 실패 큐(dead).
  // 판정은 정상 실패와 같은 함수를 쓴다 — 회수만 다른 규칙을 쓰면 규약이 둘로 갈린다.
  const retry = rows.filter((r) => nextStatusAfterFailure(r.attempt, r.max_attempts) === 'failed')
  const giveUp = rows.filter((r) => nextStatusAfterFailure(r.attempt, r.max_attempts) !== 'failed')

  const patch = {
    locked_at: null,
    locked_by: null,
    next_run_at: nowIso,          // 백오프 없이 바로 — 이미 오래 멈춰 있었다
    error_code: 'STALLED',
    error_message: '실행이 중단된 채 잠금이 만료되어 회수했습니다',
    updated_at: nowIso,
  }

  let recovered = 0
  for (const [ids, status] of [[retry, 'failed'], [giveUp, 'dead']] as const) {
    if (ids.length === 0) continue
    // status 조건을 함께 건다 — 그 사이 정상 종료됐으면 0행이 갱신되고 건드리지 않는다
    const { data: updated } = await adminClient
      .from('ci_jobs')
      .update({ ...patch, status })
      .in('id', ids.map((r) => r.id))
      .eq('status', 'running')
      .select('id')
    recovered += (updated ?? []).length
  }

  // 매달린 실행 기록도 함께 닫는다 — 열린 채 두면 관측이 거짓말을 한다
  if (recovered > 0) {
    await adminClient
      .from('ci_job_runs')
      .update({
        finished_at: nowIso,
        status: 'failed',
        error_code: 'STALLED',
        error_message: '실행이 중단된 채 잠금이 만료되어 회수했습니다',
      })
      .in('job_id', rows.map((r) => r.id))
      .eq('status', 'running')
  }

  return recovered
}

/**
 * 지금 처리할 수 있는 잡 수. 브라우저 구동기가 "더 돌릴지"를 정하는 근거다.
 * running은 세지 않는다 — 지금 누군가 잡고 있는 것이지 대기가 아니다.
 */
export async function countPendingJobs(workspaceId?: string | null): Promise<number> {
  const adminClient = createAdminClient() as any
  let query = adminClient
    .from('ci_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'failed'])
    .lte('next_run_at', new Date().toISOString())
  if (workspaceId) query = query.eq('workspace_id', workspaceId)

  const { count } = await query
  return count ?? 0
}

/** 잠금이 만료된 running 잡 수. 백스톱이 "돌 이유가 있는가"를 판단할 때 쓴다. */
export async function countStalledJobs(
  staleMs: number,
  workspaceId?: string | null,
): Promise<number> {
  const adminClient = createAdminClient() as any
  let query = adminClient
    .from('ci_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'running')
    .lt('locked_at', new Date(Date.now() - staleMs).toISOString())
  if (workspaceId) query = query.eq('workspace_id', workspaceId)

  const { count } = await query
  return count ?? 0
}

export async function startRun(jobId: string, attempt: number): Promise<string | null> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_job_runs')
      .insert({ job_id: jobId, attempt, status: 'running' })
      .select('id').single()
    return data?.id ?? null
  } catch {
    return null
  }
}

export interface FinishInput {
  jobId: string
  runId: string | null
  attempt: number
  maxAttempts: number
  status: 'succeeded' | 'failed'
  errorCode?: string
  errorMessage?: string
  durationMs?: number
  tokensUsed?: number
  /** 관리자 로그에 어느 워크스페이스 일인지 남기려고. 안 주면 안 남긴다 — 지어내지 않는다 */
  workspaceId?: string | null
}

/**
 * 잡을 마무리한다. 실패면 백오프 후 재시도, 한도를 넘으면 실패 큐(DLQ)로 보낸다.
 * 성공·실패 모두 ci_job_runs에 한 줄씩 남는다 — 침묵 실패가 없어야 관측이 가능하다.
 */
export async function finishJob(input: FinishInput): Promise<CiJobStatus> {
  const adminClient = createAdminClient() as any
  const nowIso = new Date().toISOString()

  let finalStatus: CiJobStatus
  if (input.status === 'succeeded') {
    finalStatus = 'succeeded'
  } else {
    finalStatus = nextStatusAfterFailure(input.attempt, input.maxAttempts)
  }

  const nextRunAt = finalStatus === 'failed'
    ? new Date(Date.now() + backoffSeconds(input.attempt) * 1000).toISOString()
    : nowIso

  try {
    await adminClient.from('ci_jobs').update({
      status: finalStatus,
      next_run_at: nextRunAt,
      locked_at: null,
      locked_by: null,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage ?? null,
      updated_at: nowIso,
    }).eq('id', input.jobId)

    if (input.runId) {
      await adminClient.from('ci_job_runs').update({
        finished_at: nowIso,
        status: input.status,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage ?? null,
        duration_ms: input.durationMs ?? null,
        tokens_used: input.tokensUsed ?? null,
      }).eq('id', input.runId)
    }
  } catch {
    // 잡 기록 실패는 삼킨다 — 이미 처리한 작업을 되돌리지 않는다
  }

  /**
   * **더 못 하고 끝난 것만** 관리자 로그에 올린다.
   *
   * 재시도 대기(`pending`)는 사건이 아니다 — 다음 차례에 될 수도 있는데 그때마다 올리면
   * 로그가 재시도 횟수만큼 부풀고, 정작 진짜로 죽은 잡이 그 안에 묻힌다.
   * `ci_jobs` 는 그대로 두고 **투영만** 한다(도메인 진실은 거기가 맡는다).
   */
  if (finalStatus === 'dead') {
    const { recordSystemEventAsync } = await import('../../system-log/record.ts')
    await recordSystemEventAsync({
      source: 'ci_job',
      error: new Error(input.errorMessage ?? '작업이 실패했습니다'),
      feature: 'ci-collect',
      workspaceId: input.workspaceId ?? null,
      context: { jobId: input.jobId, attempt: input.attempt, errorCode: input.errorCode ?? null },
    })
  }

  return finalStatus
}
