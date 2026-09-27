import 'server-only'

/**
 * Jev 서버 배선 — **기존 AI 계층을 지나간다** (명세 §17.1)
 *
 * 새 키 풀도 새 예산도 새 원장도 만들지 않는다. Jev 는 공급자 목록의 한 줄이고
 * (`lib/ai/provider-catalog.ts`), 키는 `ai_provider_keys` 에서 나오며,
 * 호출은 `guardedText` 를 지나 가림·예산·원장·실패 사유를 함께 받는다.
 *
 * 그렇게 해야 「AI 호출이 얼마나 나갔나」를 한 자리에서 셀 수 있다 —
 * 실측 전례: 상한을 아는 자리가 0곳이라 하루 23,318건이 나갔고 그중 22,131건은
 * 어차피 한도로 실패했다.
 *
 * 판단 규칙 자체는 `jev-core.ts` 에 있다. 여기는 벤더까지 가는 길만 잇는다.
 */

import { guardedText } from '@/lib/ai/guarded-call'
import { serverAiLedger } from '@/lib/ai/ledger'
import { serverKnownNames } from '@/lib/ai/known-names'
import { resolveProviderKey } from '@/lib/ai/provider-key-source'
import { openAiCompatibleBaseUrl, type AiProviderId } from '@/lib/ai/provider-catalog'
import { BudgetDeniedError } from '@/lib/ai/budget'
import { withProviderKeys } from '@/lib/ai/key-rotation'
import { createJevJudge, JevBudgetDeniedError, type JevCaller } from './jev-core.ts'
import type { Judge } from './types.ts'

const SURFACE = 'trading'
const PURPOSE = 'trading_judge'

export class JevNotConfiguredError extends Error {
  readonly userMessage = 'Jev 키나 모델이 설정되지 않아 판단을 부를 수 없습니다'
  constructor(reason: string) {
    super(reason)
    this.name = 'JevNotConfiguredError'
  }
}

/**
 * 관문(OpenAI 호환)으로 한 번 부른다.
 */
function gatewayCaller(provider: AiProviderId, apiKey: string, model: string): JevCaller {
  const baseUrl = openAiCompatibleBaseUrl(provider)
  if (!baseUrl) throw new JevNotConfiguredError(`${provider}_base_url_missing`)

  return async (maskedPrompt: string): Promise<string> => {
    const result = await guardedText(
      maskedPrompt,
      {
        surface: SURFACE,
        purpose: PURPOSE,
        providerId: provider,
        modelName: model,
        knownNames: await serverKnownNames(),
      },
      serverAiLedger(),
      /**
       * **키를 갈아 가며 한 번 부른다** (`lib/ai/key-rotation.ts`).
       *
       * 한 키가 한도(429)·인증(401·403)·과부하(503)에 걸리면 다음 키로 같은 일을 다시 한다.
       * 무료 키가 먼저고 유료 키가 나중이다(`lib/ai/key-pool.ts`).
       *
       * **왜 이 자리인가** (실측 2026-09-27): 등록된 Gemini 키 넷 중 하나는 그 순간
       * 503 이었고 다른 셋은 200 이었다. 첫 키 하나만 쓰면 그 분의 판단은 그냥 사라진다 —
       * 하필 바쁜 순간에만 빠지는 편향이 되고, 그것이 D-41 이 경계하는 것이다.
       *
       * 원장은 이 바깥이라 **한 판단이 한 줄**로 남는다. 교체는 그 안의 일이다.
       */
      async (prompt) => withProviderKeys(provider, apiKey, async (key) => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            // 판단은 재현 가능해야 한다. 같은 입력에 다른 답이 나오면 보정이 배울 것이 없다
            temperature: 0,
            response_format: { type: 'json_object' },
          }),
        })
        if (!response.ok) {
          /**
           * 벤더 본문을 그대로 싣지 않는다 — 내부 구조가 오류 문장으로 샌다.
           *
           * 상태 코드는 남긴다. 교체 판정이 이 글자를 보고 「이 키의 문제」와
           * 「모델의 문제」를 가른다 — 404 는 키를 안 태우고 그대로 올린다.
           */
          throw new Error(`${provider}_http_${response.status}`)
        }
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
}

export interface JevJudgeOptions {
  /** 설정 `jev_timeout_seconds` 를 ms 로 */
  timeoutMs: number
  /** 관리자가 고른 모델 이름. 관문 뒤 모델은 우리가 못 정한다 */
  model: string
  /**
   * 어느 공급자로 부르나. 기본은 Vercel 관문(`jev`)이다.
   *
   * **왜 고를 수 있어야 하나** (실측 2026-09-27): Vercel 관문 무료 등급은
   * anthropic·google 모델이 전부 403 이다. 정작 우리는 Gemini 유료 키를 이미 갖고 있고
   * 그 키로는 44개 모델이 다 열린다. 판단기는 특권이 없으므로(§7.2) 어느 벤더의 모델을
   * 쓰는지는 **설정이 정할 일**이지 코드가 박아 둘 일이 아니다.
   */
  provider?: AiProviderId
}

/**
 * 부를 수 있는 Jev 판단기. 키나 모델이 없으면 **만들지 않는다** —
 * 반쯤 된 판단기를 돌려주면 그 사실이 판단 기록에서 「기권」으로 섞여 원인을 못 찾는다.
 */
export async function createServerJevJudge(options: JevJudgeOptions): Promise<Judge> {
  const provider = options.provider ?? 'jev'
  const model = options.model.trim()
  if (model === '') throw new JevNotConfiguredError(`${provider}_model_missing`)

  /**
   * 부를 문이 없으면 **판단기를 안 만든다.**
   * 반쯤 된 판단기를 돌려주면 그 사실이 판단 기록에서 「기권」으로 섞여 원인을 못 찾는다.
   */
  if (!openAiCompatibleBaseUrl(provider)) throw new JevNotConfiguredError(`${provider}_base_url_missing`)

  const choice = await resolveProviderKey(provider, null)
  // 「키가 없다」와 「판이 달라 안 쓴다」를 구분해 남긴다 — 둘의 조치가 다르다
  if (!choice.apiKey) throw new JevNotConfiguredError(`${provider}_key_unavailable:${choice.reason}`)

  const call = gatewayCaller(provider, choice.apiKey, model)
  return createJevJudge({
    timeoutMs: options.timeoutMs,
    modelVersion: model,
    // 예산 거절은 오류가 아니라 기권이다. 그 구분을 판단기가 알아볼 수 있게 갈아 끼운다
    call: async (prompt) => {
      try {
        return await call(prompt)
      } catch (error) {
        if (error instanceof BudgetDeniedError) throw new JevBudgetDeniedError(error.message)
        throw error
      }
    },
  })
}
