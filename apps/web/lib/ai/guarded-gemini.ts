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

import { guardedText, beginGuardedStream, type AiLedger, type GuardedStreamHandle } from './guarded-call.ts'
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
  /**
   * 벤더 쪽 생성 설정에 더 얹을 것 — `maxOutputTokens`, `thinkingConfig` 같은 것.
   *
   * 옮기면서 이 값을 흘리면 비용과 응답 시간이 조용히 달라진다. 실제로 300자로
   * 묶어 둔 길과 생각 예산을 0으로 꺼 둔 길이 있었다.
   */
  extraConfig?: Record<string, unknown>
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
        ...(input.extraConfig ?? {}),
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

export interface GeminiTurn { role: 'user' | 'model'; text: string }

export interface GuardedGeminiStreamInput extends Omit<GuardedGeminiInput, 'prompt'> {
  /** 한 번에 묻는 길 */
  prompt?: string
  /** 주고받은 대화로 묻는 길. `prompt` 대신 쓴다 */
  turns?: readonly GeminiTurn[]
  /** 대화 위에 얹는 지시 */
  system?: string
}

export interface GuardedGeminiStream {
  /** 벤더가 흘려 주는 몸통 그대로 */
  body: ReadableStream<Uint8Array>
  unmask(text: string): string
  /** 흐르는 중에 화면에 붙일 때 — 반쪽 자리표 앞에서 끊는다 */
  unmaskStreaming(text: string): string
  done: GuardedStreamHandle['done']
}

/**
 * 흘려보내는 Gemini 호출 한 자리.
 *
 * 흐름은 화면이 «지금 쓰이는 중» 을 보여 주려고 쓴다. 그 값을 잃지 않으려면
 * 관문이 답을 다 모았다가 주면 안 된다. 그래서 몸통은 그대로 넘기고,
 * 가림은 나가기 전에, 기록은 끝날 때 붙인다.
 */
export async function guardedGeminiStream(
  input: GuardedGeminiStreamInput,
): Promise<GuardedGeminiStream> {
  const names = input.knownNames ?? await serverKnownNames()
  // 지시와 대화를 한 번에 가린다 — 따로 가리면 같은 이름이 토막마다 다른 번호를 받는다
  const turns = input.turns ?? (input.prompt !== undefined ? [{ role: 'user' as const, text: input.prompt }] : [])
  if (turns.length === 0) throw new Error('보낼 글이 없다')
  const handle = await beginGuardedStream(
    [input.system ?? '', ...turns.map((t) => t.text)],
    {
      surface: input.surface, purpose: input.purpose,
      actorId: input.actorId ?? null, providerId: 'gemini', modelName: input.model,
      knownNames: names,
    },
    input.ledger ?? serverAiLedger(),
  )

  let res: Response
  try {
    res = await fetch(`${GEMINI_BASE}/models/${input.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
      body: JSON.stringify({
        ...(input.system ? { system_instruction: { parts: [{ text: handle.parts[0] }] } } : {}),
        contents: turns.map((t, i) => ({ role: t.role, parts: [{ text: handle.parts[i + 1] }] })),
        generationConfig: {
          ...(input.json === true ? { responseMimeType: 'application/json' } : {}),
          temperature: input.temperature ?? 0.1,
          ...(input.extraConfig ?? {}),
        },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 300_000),
    })
  } catch (e) {
    await handle.done({ ok: false, error: e instanceof Error ? e.message : String(e) })
    throw e
  }
  if (!res.ok || !res.body) {
    await handle.done({ ok: false, error: `Gemini API error: ${res.status}` })
    throw new GeminiCallError(res.status)
  }
  return {
    body: res.body, unmask: handle.unmask,
    unmaskStreaming: handle.unmaskStreaming, done: handle.done,
  }
}
