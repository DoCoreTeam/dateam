import 'server-only'

/**
 * 청산 판단 Jev 섀도 — **기록만 하고 알림으로 안 나간다** (§7.3 D-11)
 *
 * 진입 Jev(`jev.ts`)와 **같은 길**을 쓴다: 같은 키, 같은 예산, 같은 원장.
 * 청산이라고 따로 키를 두면 「어느 쪽이 얼마나 썼나」를 못 세고, 예산이 두 배가 된다.
 *
 * 이 모듈이 쓰는 표는 `trading_exit_judgments` 하나뿐이고, 그 표는 `is_shadow` 가
 * 참이 아니면 행이 서지 않는다. 신호·알림 표로 가는 길은 없다 — 가드가 센다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { guardedText } from '@/lib/ai/guarded-call'
import { serverAiLedger } from '@/lib/ai/ledger'
import { serverKnownNames } from '@/lib/ai/known-names'
import { resolveProviderKey } from '@/lib/ai/provider-key-source'
import { getProviderSpec } from '@/lib/ai/provider-catalog'
import { BudgetDeniedError } from '@/lib/ai/budget'
import {
  buildExitPrompt, parseExitResponse, EXIT_PROMPT_VERSION,
  type ExitContext, type ExitScore,
} from './exit-core.ts'

const SURFACE = 'trading'
const PURPOSE = 'trading_exit_judge'

export type ExitJudgeOutcome =
  | { status: 'completed'; score: ExitScore }
  /** 기권도 기록한다. 기권률을 세어 봐야 편향이 생겼는지 안다(D-41) */
  | { status: 'abstain'; reason: string }
  | { status: 'failed'; reason: string }

export interface ExitJudgeInput {
  contractCode: string
  barCloseAt: Date
  specVersion: string
  ctx: ExitContext
  closes: readonly number[]
  timeoutMs: number
  model: string
  /**
   * 지금 시각. **받는다** — 판단 계층이 `new Date()` 를 직접 부르면 백테스트가 미래를 본다(M5).
   * 시각을 밖에서 주면 과거 시점으로 같은 코드를 돌릴 수 있다.
   */
  now: Date
}

const TIMED_OUT = Symbol('exit_timeout')

/**
 * 한 분의 청산 판단.
 *
 * **선점이 먼저다.** 유일 키 `(월물, 봉 시각, 판단기, 스펙 판)` 으로 행을 먼저 넣고,
 * 넣는 데 성공한 실행만 벤더를 부른다(§14.3 D-33). 안 그러면 두 크론이 같은 분에
 * 두 번 부르고 예산이 두 배로 나간다.
 */
export async function judgeExitShadow(input: ExitJudgeInput): Promise<ExitJudgeOutcome> {
  const claimed = await claim(input)
  if (!claimed) return { status: 'abstain', reason: 'already_claimed' }

  const model = input.model.trim()
  if (model === '') {
    await finish(claimed, { status: 'abstain', reason: 'model_not_set' }, null, null, model, input.now)
    return { status: 'abstain', reason: 'model_not_set' }
  }

  const choice = await resolveProviderKey('jev', null)
  if (!choice.apiKey) {
    const outcome = { status: 'abstain' as const, reason: `key_unavailable:${choice.reason}` }
    await finish(claimed, outcome, null, null, model, input.now)
    return outcome
  }

  const prompt = buildExitPrompt(input.ctx, input.closes)
  const requestAt = input.now
  const started = monotonicNow()
  let text: string | typeof TIMED_OUT
  try {
    text = await Promise.race<string | typeof TIMED_OUT>([
      callVendor(choice.apiKey, model, prompt.text),
      new Promise<typeof TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), input.timeoutMs)),
    ])
  } catch (error) {
    // 예산 거절은 실패가 아니라 기권이다. 고칠 것이 코드가 아니라 한도다
    const outcome = error instanceof BudgetDeniedError
      ? { status: 'abstain' as const, reason: 'budget_denied' }
      : { status: 'failed' as const, reason: `call_failed:${error instanceof Error ? error.message : 'unknown'}`.slice(0, 200) }
    await finish(claimed, outcome, requestAt, new Date(input.now.getTime() + elapsedSince(started)), model, input.now)
    return outcome
  }

  // 응답 시각은 실제로 걸린 만큼 흘러야 한다. 시작 시각을 그대로 쓰면 지연이 0 이 된다
  const responseAt = new Date(input.now.getTime() + elapsedSince(started))
  if (text === TIMED_OUT) {
    const outcome = { status: 'abstain' as const, reason: `timeout:${input.timeoutMs}ms` }
    await finish(claimed, outcome, requestAt, responseAt, model, input.now)
    return outcome
  }

  const score = parseExitResponse(text)
  if (!score) {
    const outcome = { status: 'abstain' as const, reason: 'unreadable_response' }
    await finish(claimed, outcome, requestAt, responseAt, model, input.now)
    return outcome
  }

  const outcome = { status: 'completed' as const, score }
  await finish(claimed, outcome, requestAt, responseAt, model, input.now)
  return outcome
}

/** 흐른 시간만 잰다. 벽시계가 아니라 경과라 과거 재현에도 뜻이 같다 */
function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0
}
function elapsedSince(started: number): number {
  return Math.max(0, Math.round(monotonicNow() - started))
}

/** 선점. 유일 키에 걸리면 남이 이미 이 분을 맡았다 */
async function claim(input: ExitJudgeInput): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_exit_judgments').insert({
    contract_code: input.contractCode,
    bar_close_at: input.barCloseAt.toISOString(),
    judge: 'jev',
    spec_version: input.specVersion,
    status: 'pending',
  }).select('id')
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) return null
    throw new Error(`청산 판단을 선점하지 못했습니다: ${error.message}`)
  }
  return ((data ?? [])[0]?.id as string | undefined) ?? null
}

async function finish(
  id: string,
  outcome: ExitJudgeOutcome,
  requestAt: Date | null,
  responseAt: Date | null,
  model: string,
  now: Date,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_exit_judgments').update({
    status: outcome.status,
    raw_score: outcome.status === 'completed' ? outcome.score : null,
    abstain_reason: outcome.status === 'completed' ? null : outcome.reason,
    jev_model_version: model,
    jev_prompt_version: EXIT_PROMPT_VERSION,
    decision_at: now.toISOString(),
    ai_request_at: requestAt?.toISOString() ?? null,
    ai_response_at: responseAt?.toISOString() ?? null,
  }).eq('id', id)
  if (error) throw new Error(`청산 판단을 적지 못했습니다: ${error.message}`)
}

/** 진입 Jev 와 같은 관문·같은 원장 */
async function callVendor(apiKey: string, model: string, prompt: string): Promise<string> {
  const baseUrl = getProviderSpec('jev').baseUrl
  if (!baseUrl) throw new Error('jev_base_url_missing')

  const result = await guardedText(
    prompt,
    {
      surface: SURFACE,
      purpose: PURPOSE,
      providerId: 'jev',
      modelName: model,
      knownNames: await serverKnownNames(),
    },
    serverAiLedger(),
    async (masked) => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: masked }],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      })
      if (!response.ok) throw new Error(`jev_http_${response.status}`)
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = body.choices?.[0]?.message?.content
      if (typeof text !== 'string') throw new Error('jev_empty_choice')
      return {
        text,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
      }
    },
  )
  return result.text
}
