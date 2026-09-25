import 'server-only'

/**
 * 선점 — **먼저 넣은 실행만 밖으로 나간다** (명세 §14.3 · D-33)
 *
 * ## 왜 유일 키만으로는 모자란가
 *
 * 봉 하나에 판단 한 줄이라는 규칙은 유일 키가 지켜 준다. 그런데 크론이 두 번 돌면
 * **둘 다 Jev 를 부르고** 나서 둘째가 저장에 실패한다. 돈은 두 번 나갔고,
 * 1-C 에서는 알림도 두 번 간다. 유일 키는 **저장**을 막지 호출을 막지 않는다.
 *
 * 그래서 순서를 뒤집는다. 판단 행을 `pending` 으로 **먼저** 넣고,
 * 넣는 데 성공한 실행만 다음으로 간다.
 *
 * ## 왜 이어받기가 있나
 *
 * 선점한 실행이 죽으면 그 봉은 영원히 `pending` 으로 남는다. 60초가 지나면
 * 다음 실행이 이어받는다 — 그래야 한 번의 사고가 하루를 망치지 않는다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { JudgeName } from '../judge/types.ts'

export interface ClaimKey {
  contractCode: string
  decisionTf: string
  /** 판단 대상 봉의 마감 시각 */
  barCloseAt: Date
  specVersion: string
  judge: JudgeName
}

export interface ClaimContext {
  triggerId: string | null
  tradingLogicVersion: string | null
  settingsVersion: number | null
  jevModelVersion?: string | null
  jevPromptVersion?: string | null
  stateHash?: string | null
}

/** 선점 후 이만큼 `pending` 이면 죽은 것으로 보고 이어받는다(§14.3) */
export const STALE_CLAIM_MS = 60_000

/**
 * 선점한다.
 *
 * `ON CONFLICT DO NOTHING` 이라 이미 있는 봉이면 **아무 줄도 안 돌려준다.**
 * 「있나 먼저 보고 없으면 넣기」로 쓰면 보는 동안 남이 넣을 수 있고,
 * 그러면 둘 다 자기가 넣었다고 믿는다.
 *
 * @returns 선점에 성공하면 그 판단 행의 id, 아니면 null
 */
export async function claimJudgment(
  key: ClaimKey,
  context: ClaimContext,
  now: Date,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_judgments')
    .insert({
      contract_code: key.contractCode,
      decision_tf: key.decisionTf,
      bar_close_at: key.barCloseAt.toISOString(),
      spec_version: key.specVersion,
      judge: key.judge,
      trigger_id: context.triggerId,
      status: 'pending',
      claimed_at: now.toISOString(),
      trading_logic_version: context.tradingLogicVersion,
      settings_version: context.settingsVersion,
      jev_model_version: context.jevModelVersion ?? null,
      jev_prompt_version: context.jevPromptVersion ?? null,
      state_hash: context.stateHash ?? null,
    })
    .select('id')

  if (error) {
    // 유일 키 충돌은 오류가 아니라 「남이 먼저 잡았다」이다
    if (isUniqueViolation(error)) return null
    throw new Error(`판단을 선점하지 못했습니다: ${error.message}`)
  }
  return (data ?? [])[0]?.id ?? null
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || /duplicate key/i.test(error.message ?? '')
}

/**
 * 오래 멈춘 선점을 이어받는다.
 *
 * 조건절에 시간을 넣어 **DB 가 판정하게** 한다. 읽고 나서 코드가 판단하면
 * 그 사이에 남이 이어받을 수 있다.
 */
export async function takeOverStaleClaim(key: ClaimKey, now: Date): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_judgments')
    .update({ claimed_at: now.toISOString() })
    .eq('contract_code', key.contractCode)
    .eq('decision_tf', key.decisionTf)
    .eq('bar_close_at', key.barCloseAt.toISOString())
    .eq('spec_version', key.specVersion)
    .eq('judge', key.judge)
    .eq('status', 'pending')
    .lt('claimed_at', new Date(now.getTime() - STALE_CLAIM_MS).toISOString())
    .select('id')
  if (error) throw new Error(`멈춘 선점을 이어받지 못했습니다: ${error.message}`)
  return (data ?? [])[0]?.id ?? null
}

export interface JudgmentOutcome {
  status: 'completed' | 'abstain' | 'failed'
  rawScore?: Record<string, number> | null
  abstainReason?: string | null
  decisionAt: Date
  aiRequestAt?: Date | null
  aiResponseAt?: Date | null
}

export async function finishJudgment(id: string, outcome: JudgmentOutcome): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('trading_judgments')
    .update({
      status: outcome.status,
      raw_score: outcome.rawScore ?? null,
      abstain_reason: outcome.abstainReason ?? null,
      decision_at: outcome.decisionAt.toISOString(),
      ai_request_at: outcome.aiRequestAt?.toISOString() ?? null,
      ai_response_at: outcome.aiResponseAt?.toISOString() ?? null,
    })
    .eq('id', id)
  if (error) throw new Error(`판단 결과를 저장하지 못했습니다: ${error.message}`)
}

// ── 크론 실행 ────────────────────────────────────────────

/**
 * 이 분의 실행을 맡는다. 같은 분에 두 번 들어오면 **둘째는 안 돈다**.
 *
 * @returns 맡았으면 true
 */
export async function startJobRun(jobName: string, scheduledMinute: Date): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_job_runs').insert({
    job_name: jobName,
    scheduled_minute: scheduledMinute.toISOString(),
    status: 'running',
    started_at: new Date().toISOString(),
  })
  if (error) {
    if (isUniqueViolation(error)) return false
    throw new Error(`실행 기록을 시작하지 못했습니다: ${error.message}`)
  }
  return true
}

export async function finishJobRun(input: {
  jobName: string
  scheduledMinute: Date
  status: 'done' | 'failed' | 'skipped'
  reason?: string | null
  userMessage?: string | null
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('trading_job_runs')
    .update({
      status: input.status,
      finished_at: new Date().toISOString(),
      reason: input.reason ?? null,
      user_message: input.userMessage ?? null,
    })
    .eq('job_name', input.jobName)
    .eq('scheduled_minute', input.scheduledMinute.toISOString())
  // 기록이 저장을 막지 않는다 — 남기다 실패해도 그 분의 일은 이미 끝났다.
  // 대신 조용히 넘어가지 않고 서버 로그에 남긴다
  if (error) console.error('[trading] 실행 기록을 닫지 못했습니다', error.message)
}
