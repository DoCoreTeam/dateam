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
import { getProviderSpec } from '@/lib/ai/provider-catalog'
import { BudgetDeniedError } from '@/lib/ai/budget'
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
 *
 * 주소는 공급자 명세의 `baseUrl` 상수다 — 바깥 값이 주소에 안 섞인다(S4).
 */
function gatewayCaller(apiKey: string, model: string): JevCaller {
  const spec = getProviderSpec('jev')
  const baseUrl = spec.baseUrl
  if (!baseUrl) throw new JevNotConfiguredError('jev_base_url_missing')

  return async (maskedPrompt: string): Promise<string> => {
    const result = await guardedText(
      maskedPrompt,
      {
        surface: SURFACE,
        purpose: PURPOSE,
        providerId: 'jev',
        modelName: model,
        knownNames: await serverKnownNames(),
      },
      serverAiLedger(),
      async (prompt) => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
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
          // 벤더 본문을 그대로 싣지 않는다 — 내부 구조가 오류 문장으로 샌다
          throw new Error(`jev_http_${response.status}`)
        }
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
}

export interface JevJudgeOptions {
  /** 설정 `jev_timeout_seconds` 를 ms 로 */
  timeoutMs: number
  /** 관리자가 고른 모델 이름. 관문 뒤 모델은 우리가 못 정한다 */
  model: string
}

/**
 * 부를 수 있는 Jev 판단기. 키나 모델이 없으면 **만들지 않는다** —
 * 반쯤 된 판단기를 돌려주면 그 사실이 판단 기록에서 「기권」으로 섞여 원인을 못 찾는다.
 */
export async function createServerJevJudge(options: JevJudgeOptions): Promise<Judge> {
  const model = options.model.trim()
  if (model === '') throw new JevNotConfiguredError('jev_model_missing')

  const choice = await resolveProviderKey('jev', null)
  // 「키가 없다」와 「판이 달라 안 쓴다」를 구분해 남긴다 — 둘의 조치가 다르다
  if (!choice.apiKey) throw new JevNotConfiguredError(`jev_key_unavailable:${choice.reason}`)

  const call = gatewayCaller(choice.apiKey, model)
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
