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
import { openAiCompatibleBaseUrl, type AiProviderId } from '@/lib/ai/provider-catalog'
import { BudgetDeniedError } from '@/lib/ai/budget'
import { withProviderKeys } from '@/lib/ai/key-rotation'
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
   * 어느 공급자로 부르나. **진입 Jev 와 같아야 한다** (§17.1) —
   * 갈리면 같은 키·같은 예산·같은 원장이라는 전제가 깨지고, 청산 섀도 성적이
   * 진입과 다른 벤더의 것이 된다.
   */
  provider: AiProviderId
  /**
   * 생각 깊이. **진입 Jev 와 같은 설정 키(`jev_reasoning_effort`)를 읽는다** (§17.1).
   *
   * 갈리면 청산 섀도 성적이 진입과 다른 조건의 것이 된다 — 깊게 생각한 판과 얕게
   * 생각한 판은 같은 입력에 다른 답을 준다 (실측 2026-09-28: 0.85/0.05/0.10 대 0.7/0.1/0.2).
   *
   * 빈 값이면 줄을 아예 안 싣는다. 빈 문자열은 관문이 400 으로 거절한다.
   */
  reasoningEffort: string
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

  const choice = await resolveProviderKey(input.provider, null)
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
      callVendor(input.provider, choice.apiKey, model, prompt.text, input.reasoningEffort),
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
async function callVendor(
  provider: AiProviderId, apiKey: string, model: string, prompt: string, reasoningEffort: string,
): Promise<string> {
  const baseUrl = openAiCompatibleBaseUrl(provider)
  if (!baseUrl) throw new Error(`${provider}_base_url_missing`)

  const result = await guardedText(
    prompt,
    {
      surface: SURFACE,
      purpose: PURPOSE,
      providerId: provider,
      modelName: model,
      knownNames: await serverKnownNames(),
    },
    serverAiLedger(),
    // 진입과 **같은 교체 규칙**을 쓴다. 한쪽만 첫 키로 끝내면 둘의 성적이 다른 조건의 것이 된다
    async (masked) => withProviderKeys(provider, apiKey, async (key) => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: masked }],
          temperature: 0,
          response_format: { type: 'json_object' },
          /**
           * 진입 Jev 와 **같은 줄**이다 (`judge/jev.ts`). 안 정하면 관문이 제 마음대로
           * 오래 생각하고, 그 사이 우리가 먼저 끊는다 — 실측 2026-09-28 에 같은 프롬프트가
           * 19.7~21.5초 걸렸고 출력 3,290토큰 중 3,254개가 생각이었다.
           *
           * 빈 값이면 줄을 아예 뺀다. 빈 문자열은 관문이 400 으로 거절하고
           * 그 400 이 키 문제·모델 문제와 섞인다.
           */
          ...(reasoningEffort === '' ? {} : { reasoning_effort: reasoningEffort }),
        }),
      })
      // 상태 코드를 남긴다 — 교체 판정이 이 글자로 키 문제와 모델 문제를 가른다
      if (!response.ok) throw new Error(`${provider}_http_${response.status}`)
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = body.choices?.[0]?.message?.content
      if (typeof text !== 'string') throw new Error(`${provider}_empty_choice`)
      return {
        text,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
      }
    }),
  )
  return result.text
}
