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
 */
export async function claimJobs(limit: number, workerId: string): Promise<ClaimedJob[]> {
  const adminClient = createAdminClient() as any
  const nowIso = new Date().toISOString()

  const { data: candidates } = await adminClient
    .from('ci_jobs')
    .select('id, workspace_id, idempotency_key, stage, target_type, target_id, payload, attempt, max_attempts')
    .in('status', ['queued', 'failed'])
    .lte('next_run_at', nowIso)
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

  return finalStatus
}
