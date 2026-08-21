// Gemini generateContent 공통 호출기 (SSOT) — 타임아웃·재시도·모델 폴백·JSON 복구를 한 곳에 둔다.
//
// 왜 생겼나(v0.7.571): 27개 파일이 각자 `fetch(...generateContent)`를 조립하고 있었고
// **타임아웃이 0곳**이었다. 모델이 매달리면 요청이 영원히 안 끝나고, 화면은 "분석 중…"에
// 고정된다(실측: 회의노트 요약 33초 / 추출 84초 동안 아무 피드백 없음 — 사용자 눈에는 정지와 같다).
// 재시도도 폴백도 없어서 429·503 한 번이면 그대로 실패했다.
//
// 설계 원칙
//  1. **조용히 실패하지 않는다** — 모든 실패는 원인(reason)과 사용자가 읽을 말(userMessage)을 갖는다.
//  2. **재시도로 안 풀리는 실패는 재시도하지 않는다** — 인증 오류·JSON 미지원 모델은 즉시 다음 단계로.
//     "다시 시도해 주세요"라고 해놓고 100% 또 실패하는 안내를 만들지 않는다.
//  3. **전체 데드라인이 있다** — 모델 3개 × 재시도가 곱해져 몇 분씩 매달리는 일을 막는다.

import {
  DEFAULT_GEMINI_MODEL,
  describeModelIssue,
  resolveGeminiModelChain,
} from './gemini-model.ts'
import { JsonRecoverError, recoverJson } from './json-recover.ts'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** 한 번의 호출이 매달릴 수 있는 최대 시간. 실측 15~25초라 여유를 둔 값. */
export const GEMINI_CALL_TIMEOUT_MS = 60_000
/** 모델 폴백·재시도를 전부 합친 상한. 이걸 넘기면 더 시도하지 않고 실패로 끝낸다. */
export const GEMINI_OVERALL_TIMEOUT_MS = 120_000
/** 일시적 실패(429/5xx/네트워크)에 대한 모델당 재시도 횟수. */
const MAX_RETRIES_PER_MODEL = 2

/**
 * 기본 출력 상한. "생략하지 말라"는 정제 계약 때문에 응답이 길어질 수 있어 넉넉히 잡는다.
 * 상한에 닿으면 JSON이 중간에서 끊겨 파싱이 실패하므로, 상한 자체가 곧 무손실의 전제다.
 */
export const GEMINI_MAX_OUTPUT_TOKENS = 32_768

export type GeminiFailureReason =
  | 'timeout'
  | 'auth'
  | 'quota'
  | 'no_model'
  | 'bad_json'
  | 'truncated'
  | 'network'
  | 'server'

export class GeminiCallError extends Error {
  readonly reason: GeminiFailureReason
  /** 화면에 그대로 띄울 수 있는 말 — 원인 + 다음에 무엇을 하면 되는지. */
  readonly userMessage: string
  /** 어떤 모델로 무엇을 시도했는지(로그·디버깅용). */
  readonly attempts: string[]

  constructor(reason: GeminiFailureReason, userMessage: string, attempts: string[]) {
    super(`${reason}: ${userMessage}`)
    this.name = 'GeminiCallError'
    this.reason = reason
    this.userMessage = userMessage
    this.attempts = attempts
  }
}

export interface GeminiUsage {
  prompt: number
  output: number
  total: number
}

export interface GeminiJsonResult {
  /** 복구까지 마친 파싱 결과. */
  value: unknown
  usage: GeminiUsage
  /** 실제로 응답을 준 모델(설정 모델과 다를 수 있다). */
  model: string
  /** 설정 모델이 아닌 모델로 처리했으면 그 이유. 화면이 사용자에게 알릴 수 있게 한다. */
  fallbackNotice: string | null
}

export interface CallGeminiJsonOptions {
  prompt: string
  apiKey: string
  /** 어드민이 고른 모델(org_content META). 못 쓰는 모델이면 자동으로 대체된다. */
  model?: string | null
  temperature?: number
  timeoutMs?: number
  overallTimeoutMs?: number
  /** 출력 토큰 상한. 길게 답해야 하는 기능은 올린다. */
  maxOutputTokens?: number
  /** 로그 라벨(기능 이름). */
  feature?: string
}

interface RawCallOutcome {
  kind: 'ok' | 'retryable' | 'model-dead' | 'fatal'
  text?: string
  usage?: GeminiUsage
  reason?: GeminiFailureReason
  detail: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 한 모델에 한 번 호출한다. 성공/재시도가능/모델폐기/치명 중 하나로 분류해 돌려준다. */
async function callOnce(
  model: string,
  prompt: string,
  apiKey: string,
  temperature: number,
  timeoutMs: number,
  maxOutputTokens: number
): Promise<RawCallOutcome> {
  let res: Response
  try {
    res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const aborted = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return {
      kind: 'retryable',
      reason: aborted ? 'timeout' : 'network',
      detail: aborted ? `${model}: ${timeoutMs}ms 초과` : `${model}: 네트워크 오류(${(e as Error).message})`,
    }
  }

  // 인증 실패는 재시도해도 절대 안 풀린다 — 즉시 중단하고 원인을 그대로 말한다.
  if (res.status === 401 || res.status === 403) {
    return { kind: 'fatal', reason: 'auth', detail: `${model}: 인증 실패(HTTP ${res.status})` }
  }
  // 모델이 없거나 이 용도로 못 쓴다 → 이 모델은 버리고 다음 모델로.
  if (res.status === 404 || res.status === 400) {
    return { kind: 'model-dead', detail: `${model}: 사용 불가(HTTP ${res.status})` }
  }
  if (res.status === 429) {
    return { kind: 'retryable', reason: 'quota', detail: `${model}: 호출 한도 초과(HTTP 429)` }
  }
  if (!res.ok) {
    return { kind: 'retryable', reason: 'server', detail: `${model}: 서버 오류(HTTP ${res.status})` }
  }

  const json = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  } | null

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    return { kind: 'retryable', reason: 'server', detail: `${model}: 응답이 비어 있음` }
  }

  // 출력 상한에서 잘리면 JSON이 중간에서 끊긴다. 조용히 "파싱 실패"로 뭉뚱그리지 않고
  // 잘렸다는 사실을 그대로 올린다 — 원인이 모델이 아니라 길이이기 때문이다.
  if (json?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
    return { kind: 'fatal', reason: 'truncated', detail: `${model}: 출력 상한(${maxOutputTokens} 토큰)에서 잘림` }
  }

  return {
    kind: 'ok',
    text,
    usage: {
      prompt: json?.usageMetadata?.promptTokenCount ?? 0,
      output: json?.usageMetadata?.candidatesTokenCount ?? 0,
      total: json?.usageMetadata?.totalTokenCount ?? 0,
    },
    detail: `${model}: ok`,
  }
}

/**
 * JSON 응답을 요구하는 Gemini 호출. 설정 모델 → 폴백 모델 순으로 시도하고,
 * 일시적 실패는 지수 백오프로 재시도하며, 응답이 산문이면 그 안의 JSON을 건져낸다.
 *
 * 실패하면 GeminiCallError를 던진다 — 호출처는 `userMessage`를 그대로 화면에 보여주면 된다.
 */
export async function callGeminiJson(opts: CallGeminiJsonOptions): Promise<GeminiJsonResult> {
  const {
    prompt,
    apiKey,
    model: configured,
    temperature = 0.2,
    timeoutMs = GEMINI_CALL_TIMEOUT_MS,
    overallTimeoutMs = GEMINI_OVERALL_TIMEOUT_MS,
    maxOutputTokens = GEMINI_MAX_OUTPUT_TOKENS,
    feature = 'gemini',
  } = opts

  if (!apiKey) {
    throw new GeminiCallError('auth', 'Gemini API 키가 설정되지 않았습니다. 관리자 설정에서 키를 등록해 주세요.', [])
  }

  const chain = resolveGeminiModelChain(configured, { requireJson: true })
  const modelIssue = describeModelIssue(configured)
  const attempts: string[] = []
  const deadline = Date.now() + overallTimeoutMs
  let lastReason: GeminiFailureReason = 'server'

  for (const model of chain) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      if (Date.now() >= deadline) {
        throw new GeminiCallError(
          'timeout',
          'AI 응답이 제한 시간을 넘겼습니다. 본문이 길면 시간이 더 걸릴 수 있어요 — 잠시 후 다시 시도해 주세요.',
          attempts
        )
      }

      const remaining = Math.max(1_000, Math.min(timeoutMs, deadline - Date.now()))
      const out = await callOnce(model, prompt, apiKey, temperature, remaining, maxOutputTokens)
      attempts.push(out.detail)

      if (out.kind === 'fatal') {
        // 재시도해도, 모델을 바꿔도 결과가 같은 실패다 — 즉시 원인을 그대로 말하고 끝낸다.
        throw new GeminiCallError(
          out.reason ?? 'server',
          out.reason === 'truncated'
            ? '회의 본문이 길어 AI 응답이 중간에서 끊겼습니다. 본문을 나눠서 분석해 주세요.'
            : 'Gemini API 키가 거부됐습니다. 관리자 설정에서 키를 다시 등록해 주세요.',
          attempts
        )
      }

      if (out.kind === 'model-dead') {
        console.warn(`[${feature}] 모델 폴백: ${out.detail}`)
        break // 재시도 무의미 — 다음 모델로
      }

      if (out.kind === 'retryable') {
        lastReason = out.reason ?? 'server'
        console.warn(`[${feature}] 재시도(${attempt + 1}/${MAX_RETRIES_PER_MODEL}): ${out.detail}`)
        if (attempt < MAX_RETRIES_PER_MODEL) {
          await sleep(1_000 * 2 ** attempt)
          continue
        }
        break // 이 모델은 포기 — 다음 모델로
      }

      // ok — 이제 JSON을 건져낸다.
      try {
        const value = recoverJson(out.text ?? '')
        const usedFallback = model !== (configured ?? '').trim()
        return {
          value,
          usage: out.usage ?? { prompt: 0, output: 0, total: 0 },
          model,
          fallbackNotice: usedFallback
            ? modelIssue ??
              `설정된 모델을 쓸 수 없어 '${model}'로 처리했습니다. 관리자 설정에서 모델을 확인해 주세요.`
            : null,
        }
      } catch (e) {
        // 지시를 무시하고 산문을 낸 모델이다 — 같은 모델로 또 물어봐야 같은 답이 온다.
        lastReason = 'bad_json'
        const sample = e instanceof JsonRecoverError ? e.sample.slice(0, 80) : ''
        console.warn(`[${feature}] ${model}이 JSON을 내지 않아 폴백: ${sample}`)
        attempts.push(`${model}: JSON 형식 아님`)
        break // 다음 모델로
      }
    }
  }

  const hint =
    lastReason === 'bad_json'
      ? `AI가 정해진 형식으로 답하지 않았습니다. 관리자 설정의 AI 모델을 '${DEFAULT_GEMINI_MODEL}' 같은 Gemini 계열로 바꿔 주세요(Gemma 계열은 이 기능을 지원하지 않습니다).`
      : lastReason === 'quota'
        ? 'AI 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
        : lastReason === 'timeout'
          ? 'AI 응답이 제한 시간을 넘겼습니다. 잠시 후 다시 시도해 주세요.'
          : 'AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'

  /**
   * 관리자가 읽는 곳에 남긴다 — 여기까지 왔다는 것은 **사슬의 모든 모델이 실패했다**는 뜻이다.
   * 한 모델이 막혀 다음으로 넘어간 것은 사건이 아니다(그건 정상 동작이다).
   * 기다리지 않는다: 로그가 AI 호출을 더 느리게 만들면 안 된다.
   */
  const { recordSystemEventAsync } = await import('../system-log/record.ts')
  await recordSystemEventAsync({
    source: 'host_ai',
    error: new Error(`${lastReason}: ${hint}`),
    reason: lastReason === 'no_model' ? 'config' : lastReason === 'truncated' ? 'bad_json' : lastReason,
    feature,
    blocksUser: true,
    hint: configured ?? undefined,
    context: { attempts, chain },
  })

  throw new GeminiCallError(lastReason, hint, attempts)
}
