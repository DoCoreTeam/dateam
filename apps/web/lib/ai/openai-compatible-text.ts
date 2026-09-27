import 'server-only'

/**
 * OpenAI 호환 창구로 글 한 번 받기 — **한 벌만 있다**
 *
 * ## 왜 생겼나
 *
 * 판단기(`trading/judge/jev.ts`)와 청산 섀도(`exit-jev.ts`)가 같은 스물몇 줄을 각자 들고
 * 있었다. 지식·설명까지 공급자를 고를 수 있게 되면 세 벌이 된다. 세 벌이 되면 한쪽만
 * 고치는 날이 오고, 그날부터 **어느 자리가 어느 규칙으로 부르는지** 아무도 모른다.
 *
 * ## 무엇을 묶었나
 *
 *   · 주소는 **벤더 명세 상수**에서만 온다 (S4). 설정은 공급자만 고른다
 *   · 호출은 `guardedText` 를 지나 가림·예산·원장을 함께 받는다 (M12)
 *   · 키는 `withProviderKeys` 를 지나 막히면 다음 키로 이어 간다
 *   · 벤더 본문을 오류에 안 싣는다. 상태 코드만 남긴다 — 교체 판정이 그 글자를 본다
 */

import { guardedText } from './guarded-call.ts'
import { serverAiLedger } from './ledger.ts'
import { serverKnownNames } from './known-names.ts'
import { resolveProviderKey } from './provider-key-source.ts'
import { openAiCompatibleBaseUrl, type AiProviderId } from './provider-catalog.ts'
import { withProviderKeys } from './key-rotation.ts'

/**
 * 이 길로 나갈 수 있는 창구 — **아는 이름만 받는다**.
 *
 * 아무 글자나 받으면 원장에서 「어디가 AI 를 얼마나 썼나」가 갈린다. 실측 전례가 있다:
 * 원장 50,243건의 주인이 전부 비어 있었고 누가 태웠는지 아무도 못 가렸다.
 * 이름을 여기 박아 두면 등재부(`lib/ai/actor.ts`)가 그 이름으로 이 파일을 가린다.
 */
export const COMPATIBLE_SURFACES = ['trading', 'trading_knowledge'] as const
export type CompatibleSurface = (typeof COMPATIBLE_SURFACES)[number]

export interface CompatibleTextInput {
  provider: AiProviderId
  model: string
  prompt: string
  /** 원장이 세는 자리. 「어디가 AI 를 얼마나 썼나」가 이 값으로 갈린다 */
  surface: CompatibleSurface
  purpose: string
  /** JSON 만 받겠다고 말하나 */
  json?: boolean
  temperature?: number
}

export type CompatibleTextResult =
  | { ok: true; text: string; inputTokens: number | null; outputTokens: number | null }
  /** **왜 못 했는지가 반드시 있다.** 조용히 빈 값을 안 돌려준다 */
  | { ok: false; reason: string }

/** 부를 문이 있나. 없으면 그 공급자로는 이 길을 못 간다 */
export function canCallCompatible(provider: AiProviderId): boolean {
  return openAiCompatibleBaseUrl(provider) !== null
}

export async function callCompatibleText(input: CompatibleTextInput): Promise<CompatibleTextResult> {
  const baseUrl = openAiCompatibleBaseUrl(input.provider)
  if (!baseUrl) return { ok: false, reason: `${input.provider}_base_url_missing` }
  const model = input.model.trim()
  if (model === '') return { ok: false, reason: `${input.provider}_model_missing` }

  const choice = await resolveProviderKey(input.provider, null)
  // 「키가 없다」와 「판이 달라 안 쓴다」를 구분해 남긴다 — 둘의 조치가 다르다
  if (!choice.apiKey) return { ok: false, reason: `${input.provider}_key_unavailable:${choice.reason}` }
  const firstKey = choice.apiKey

  const result = await guardedText(
    input.prompt,
    {
      surface: input.surface,
      purpose: input.purpose,
      providerId: input.provider,
      modelName: model,
      knownNames: await serverKnownNames(),
    },
    serverAiLedger(),
    // 교체는 원장 **안쪽**이다. 키를 넷 태워도 한 호출이 한 줄로 남는다
    async (masked) => withProviderKeys(input.provider, firstKey, async (key) => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: masked }],
          temperature: input.temperature ?? 0,
          ...(input.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      })
      if (!response.ok) {
        // 상태 코드는 남긴다 — 교체 판정이 이 글자로 키 문제와 모델 문제를 가른다
        throw new Error(`${input.provider}_http_${response.status}`)
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = body.choices?.[0]?.message?.content
      if (typeof text !== 'string') throw new Error(`${input.provider}_empty_choice`)
      return {
        text,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
      }
    }),
  )
  return { ok: true, text: result.text, inputTokens: null, outputTokens: null }
}
