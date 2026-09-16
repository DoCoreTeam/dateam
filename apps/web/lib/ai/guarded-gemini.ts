/**
 * 가림과 기록을 지나는 Gemini 글자 호출 한 자리
 *
 * ## 왜 한 자리인가
 *
 * 딜 해석, 딜 활동, 일일업무 분해, 일일 메모 묶기가 **각자 fetch 를 적어** 두고 있었다.
 * 네 곳 다 사람 이름과 통화 내용이 든 글을 보내면서 가림도 기록도 없었다(실측 2026-09-16).
 *
 * 복붙된 호출을 하나씩 감싸면 다섯 번째가 생기는 날 또 안 감싼 것이 하나 는다.
 * 그래서 호출 자체를 여기로 모으고, 가림과 기록은 이 자리를 지나면 자동으로 따라온다.
 *
 * ## 폴백을 여기서 안 하는 이유
 *
 * 네 길 중 폴백을 가진 것이 하나도 없었다. 없던 것을 이 단계에서 붙이면 바뀐 것이
 * 가림인지 폴백인지 구분이 안 된다. 사슬은 다음 단계 몫이다.
 */

import { guardedText, type AiLedger } from './guarded-call.ts'
import { serverAiLedger } from './ledger.ts'
import { serverKnownNames } from './known-names.ts'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GuardedGeminiInput {
  prompt: string
  apiKey: string
  model: string
  /** 어느 화면이 불렀나 */
  surface: string
  purpose: string
  /** 안 주면 서버 원장에 적는다. 안 적는 창구는 없다 */
  ledger?: AiLedger
  actorId?: string | null
  /**
   * 이 호출에 나올 수 있는 아는 이름.
   *
   * 안 주면 **구성원과 주소록 이름 전체**를 쓴다. 회의 참석자처럼 더 좁은 목록을
   * 아는 자리만 직접 준다 — 넓은 목록이 기본이어야 «이름은 다음에» 가 안 생긴다.
   */
  knownNames?: readonly string[]
  /** JSON 으로 받을 것인가 */
  json?: boolean
  temperature?: number
  /** 기본 60초. 이보다 짧게 잡아 둔 길이 있어서 옮길 때 그 값을 잃지 않게 한다 */
  timeoutMs?: number
}

export interface GuardedGeminiResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export class GeminiCallError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Gemini API error: ${status}`)
    this.name = 'GeminiCallError'
    this.status = status
  }
}

export async function guardedGeminiText(input: GuardedGeminiInput): Promise<GuardedGeminiResult> {
  const names = input.knownNames ?? await serverKnownNames()
  const out = await guardedText(
    input.prompt,
    {
      surface: input.surface, purpose: input.purpose,
      actorId: input.actorId ?? null, providerId: 'gemini', modelName: input.model,
      knownNames: names,
    },
    input.ledger ?? serverAiLedger(),
    (masked) => callGemini(masked, input),
  )
  return {
    text: out.text,
    inputTokens: out.inputTokens ?? 0,
    outputTokens: out.outputTokens ?? 0,
  }
}

/** 벤더를 실제로 부르는 유일한 자리 */
async function callGemini(
  prompt: string, input: GuardedGeminiInput,
): Promise<GuardedGeminiResult> {
  const res = await fetch(`${GEMINI_BASE}/models/${input.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        ...(input.json === false ? {} : { responseMimeType: 'application/json' }),
        temperature: input.temperature ?? 0.1,
      },
    }),
    cache: 'no-store',
    // 시간 제한이 없으면 화면이 벤더가 끊을 때까지 매달린다. 넷 다 없었다
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  })
  if (!res.ok) throw new GeminiCallError(res.status)
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  return {
    text: json.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  }
}
