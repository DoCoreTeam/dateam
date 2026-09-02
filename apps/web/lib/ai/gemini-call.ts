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
import { callFallbackJson } from './fallback-text.ts'

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

/**
 * 멀티모달 입력 한 조각. 텍스트이거나 base64 바이너리(이미지·PDF)다.
 *
 * 왜 여기 있나(v0.7.678): GPU 통합입력이 PDF·이미지를 AI에 넘겨야 해서 공용부를 못 쓰고
 * 자기 fetch 를 따로 갖고 있었다. 그 경로에만 재시도·모델 폴백·타임아웃이 없어
 * 무료 티어 한도(모델당 하루 20회) 하나에 기능이 통째로 죽었다 — 실측 2026-09-02.
 */
export interface GeminiPart {
  text?: string
  inlineData?: { data: string; mimeType: string }
}

/** 텍스트 그대로가 필요한 호출(JSON 파싱 없음)의 결과. */
export interface GeminiTextResult {
  text: string
  usage: GeminiUsage
  model: string
  fallbackNotice: string | null
}

/** 이 요청이 바이너리(이미지·PDF)를 싣고 있는가 — 텍스트 전용 폴백 공급자로 보낼 수 없다. */
function hasBinaryPart(parts: GeminiPart[] | undefined): boolean {
  return Boolean(parts?.some((p) => p.inlineData))
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
  /**
   * 두 번째 공급자 키(Groq). 주면 **Gemini 사슬이 전부 실패한 뒤에만** 시도한다.
   *
   * 왜 옵션인가: 모든 기능이 자동으로 다른 공급자로 새어 나가면 안 된다.
   * 어디로 무엇이 가는지는 호출부가 알고 정해야 한다(추가 전용, M-4).
   */
  fallbackApiKey?: string

  /**
   * 멀티모달 입력. 주면 `prompt` 대신 이 parts 를 보낸다.
   * `prompt` 는 그대로 받는다 — 폴백 공급자·로그가 쓸 텍스트가 필요하기 때문이다.
   *
   * 바이너리(이미지·PDF)가 섞이면 **폴백 공급자로는 나가지 않는다**(텍스트 전용이라
   * 보내 봐야 그림을 못 본다). 그 사실은 attempts 에 남긴다 — 조용히 건너뛰지 않는다.
   */
  parts?: GeminiPart[]

  /**
   * 주면 스트리밍(`:streamGenerateContent`)으로 부르고 토큰이 도착할 때마다 호출한다.
   *
   * 재시도·모델 교체가 일어나면 **같은 자리부터 다시 흘러온다**(응답을 이어붙일 수 없다).
   * 받는 쪽은 누적 버퍼를 굴리는 표시용으로만 쓰고, 확정값은 반환값에서 읽는다.
   */
  onDelta?: (delta: string) => void

  /**
   * 모델을 갈아타거나 재시도할 때 알려준다. 화면이 "다른 모델로 다시 시도합니다"라고
   * 말할 수 있게 하기 위한 것 — 사용자가 멈춘 줄 알고 새로고침하는 것을 막는다.
   */
  onAttempt?: (info: { model: string; attempt: number; reason: GeminiFailureReason | null }) => void
}

/** `callGeminiText` 전용 옵션. JSON 형식을 요구할지 호출부가 정한다. */
export interface CallGeminiTextOptions extends CallGeminiJsonOptions {
  /** true 면 `responseMimeType: application/json` 을 요구한다. 기본 false(산문 허용). */
  responseJson?: boolean
}

interface RawCallOutcome {
  kind: 'ok' | 'retryable' | 'model-dead' | 'fatal'
  text?: string
  usage?: GeminiUsage
  reason?: GeminiFailureReason
  detail: string
}

/**
 * 한도 차단 기억 — 사슬 전체가 429로 끝나면 그 사실을 잠시 기억한다.
 *
 * 왜 필요한가: 무료 티어 한도는 **프로젝트 단위**라 모델을 바꿔도 같이 막힌다.
 * 기억하지 않으면 호출마다 모델 3개 × 재시도 3회 = 9번을 두드리고 백오프까지 기다린 뒤
 * 매번 같은 곳에 도착한다(실측: 대조 30건이면 헛호출 270회 + 백오프만 4분).
 *
 * **폴백 키를 준 호출에서만** 이 기억을 쓴다. 폴백이 없는 호출까지 건너뛰면
 * 그 기능은 갈 곳이 없어져 그냥 실패한다 — 지금보다 나빠진다.
 */
let quotaBlockedUntil = 0
/** 차단 유지 시간. 분당 한도면 곧 풀리고, 일일 한도면 어차피 계속 막힌다 — 그 사이 값. */
export const QUOTA_COOLDOWN_MS = 10 * 60_000

/** 테스트·운영 점검용. 지금 Gemini를 건너뛰는 상태인지. */
export function isQuotaCooling(now = Date.now()): boolean {
  return now < quotaBlockedUntil
}
/** 테스트에서 상태를 초기화한다(모듈 레벨 상태는 테스트 간에 샌다). */
export function resetQuotaCooling(): void {
  quotaBlockedUntil = 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CallOnceExtras {
  /** 멀티모달 parts. 없으면 prompt 한 조각으로 보낸다. */
  parts?: GeminiPart[]
  /** JSON 형식을 요구할지. */
  json: boolean
  /** 주면 스트리밍으로 부른다. */
  onDelta?: (delta: string) => void
}

/**
 * SSE(`alt=sse`) 본문을 읽어 텍스트를 모은다.
 *
 * 청크가 반쪽으로 잘려 오는 것은 정상이라 버퍼에 이어 붙여 줄 단위로만 해석한다.
 * 마지막 청크가 usage·finishReason 를 들고 오므로 매번 덮어써 최신을 남긴다.
 */
async function readSseStream(
  res: Response,
  onDelta: (delta: string) => void
): Promise<{ text: string; usage: GeminiUsage; finishReason: string | null }> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  let usage: GeminiUsage = { prompt: 0, output: 0, total: 0 }
  let finishReason: string | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let j: {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      }
      try { j = JSON.parse(payload) } catch { continue }   // 부분 라인 — 다음 청크에서 완성된다
      const delta = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (delta) { full += delta; onDelta(delta) }
      if (j?.candidates?.[0]?.finishReason) finishReason = j.candidates[0].finishReason!
      if (j?.usageMetadata) {
        usage = {
          prompt: j.usageMetadata.promptTokenCount ?? 0,
          output: j.usageMetadata.candidatesTokenCount ?? 0,
          total: j.usageMetadata.totalTokenCount ?? 0,
        }
      }
    }
  }
  return { text: full, usage, finishReason }
}

/** 한 모델에 한 번 호출한다. 성공/재시도가능/모델폐기/치명 중 하나로 분류해 돌려준다. */
async function callOnce(
  model: string,
  prompt: string,
  apiKey: string,
  temperature: number,
  timeoutMs: number,
  maxOutputTokens: number,
  extras: CallOnceExtras = { json: true }
): Promise<RawCallOutcome> {
  const streaming = Boolean(extras.onDelta)
  const endpoint = streaming
    ? `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse`
    : `${GEMINI_API_BASE}/models/${model}:generateContent`
  const parts: GeminiPart[] = extras.parts && extras.parts.length > 0
    ? extras.parts
    : [{ text: prompt }]

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: extras.json
          ? { responseMimeType: 'application/json', temperature, maxOutputTokens }
          : { temperature, maxOutputTokens },
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

  // ── 스트리밍 경로 — 토큰이 오는 대로 흘려보내고, 끝나면 같은 규칙으로 판정한다.
  if (streaming) {
    if (!res.body) return { kind: 'retryable', reason: 'server', detail: `${model}: 스트림 본문 없음` }
    let acc: { text: string; usage: GeminiUsage; finishReason: string | null }
    try {
      acc = await readSseStream(res, extras.onDelta!)
    } catch (e) {
      const aborted = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      return {
        kind: 'retryable',
        reason: aborted ? 'timeout' : 'network',
        detail: aborted ? `${model}: 스트림 ${timeoutMs}ms 초과` : `${model}: 스트림 중단(${(e as Error).message})`,
      }
    }
    if (!acc.text) return { kind: 'retryable', reason: 'server', detail: `${model}: 응답이 비어 있음` }
    if (acc.finishReason === 'MAX_TOKENS') {
      return { kind: 'fatal', reason: 'truncated', detail: `${model}: 출력 상한(${maxOutputTokens} 토큰)에서 잘림` }
    }
    return { kind: 'ok', text: acc.text, usage: acc.usage, detail: `${model}: ok(스트림)` }
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
 * 실패 원인 → 사용자가 읽을 문장. **한 곳에서만 만든다.**
 *
 * 왜(실측 v0.7.680): 데드라인 초과와 사슬 소진이 각자 문장을 갖고 있었다.
 * 한도를 다 쓴 날 전체 예산이 먼저 끝나면 화면이 「본문이 길면 시간이 더 걸릴 수 있어요」라고
 * 말했다 — 사용자는 본문을 줄이려 든다. 실제 원인은 한도였다.
 * 그래서 **그때까지 본 마지막 원인**을 문장의 근거로 삼는다.
 */
function hintFor(reason: GeminiFailureReason): string {
  if (reason === 'bad_json') {
    return `AI가 정해진 형식으로 답하지 않았습니다. 관리자 설정의 AI 모델을 '${DEFAULT_GEMINI_MODEL}' 같은 Gemini 계열로 바꿔 주세요(Gemma 계열은 이 기능을 지원하지 않습니다).`
  }
  if (reason === 'quota') {
    return 'AI 호출 한도를 모두 썼습니다. 무료 등급은 모델마다 하루 사용량이 정해져 있어요 — 내일 다시 되거나, 관리자 설정에서 다른 AI 모델로 바꾸면 이어서 쓸 수 있습니다.'
  }
  if (reason === 'timeout') {
    return 'AI 응답이 제한 시간을 넘겼습니다. 본문이 길면 시간이 더 걸릴 수 있어요 — 잠시 후 다시 시도해 주세요.'
  }
  return 'AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

/** 사슬 실행 결과 — accept 가 만든 값과 원문 텍스트를 함께 준다. */
interface ChainResult {
  value: unknown
  text: string
  usage: GeminiUsage
  model: string
  fallbackNotice: string | null
}

/**
 * 설정 모델 → 폴백 모델 순으로 시도하는 공통 사슬. 일시적 실패는 지수 백오프로 재시도한다.
 *
 * `accept` 가 던지면 그 모델은 **형식을 못 맞춘 것**으로 보고 재시도 없이 다음 모델로 간다
 * (같은 모델에 또 물어야 같은 답이 온다).
 */
async function runGeminiChain(
  opts: CallGeminiJsonOptions,
  cfg: { json: boolean; accept: ((text: string) => unknown) | null }
): Promise<ChainResult> {
  const {
    prompt,
    apiKey,
    model: configured,
    temperature = 0.2,
    timeoutMs = GEMINI_CALL_TIMEOUT_MS,
    overallTimeoutMs = GEMINI_OVERALL_TIMEOUT_MS,
    maxOutputTokens = GEMINI_MAX_OUTPUT_TOKENS,
    feature = 'gemini',
    fallbackApiKey,
    parts,
    onDelta,
    onAttempt,
  } = opts

  if (!apiKey) {
    throw new GeminiCallError('auth', 'Gemini API 키가 설정되지 않았습니다. 관리자 설정에서 키를 등록해 주세요.', [])
  }

  const chain = resolveGeminiModelChain(configured, { requireJson: cfg.json })
  const modelIssue = describeModelIssue(configured)
  const attempts: string[] = []
  const deadline = Date.now() + overallTimeoutMs
  let lastReason: GeminiFailureReason = 'server'

  // 폴백 공급자(Groq)는 **텍스트 JSON 전용**이다. 그림을 못 보고, 산문 요청도 다루지 않는다.
  // 갈 수 없다는 사실을 조용히 넘기지 않고 attempts 에 남긴다 — 안 간 이유가 보여야 한다.
  const binary = hasBinaryPart(parts)
  const canFallback = Boolean(fallbackApiKey) && cfg.json && !binary
  if (fallbackApiKey && !canFallback) {
    attempts.push(binary
      ? '폴백 공급자: 이미지·PDF 가 포함돼 건너뜀(텍스트 전용)'
      : '폴백 공급자: JSON 응답 호출이 아니라 건너뜀')
  }

  // 방금 전에 사슬 전체가 한도로 막혔고 갈 곳(폴백)이 있으면, 두드리지 않고 바로 넘어간다.
  const skipGemini = canFallback && isQuotaCooling()
  if (skipGemini) attempts.push('Gemini: 최근 한도 초과가 확인돼 건너뜀')

  let overall = 0
  for (const model of skipGemini ? [] : chain) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      if (Date.now() >= deadline) {
        // 예산이 끝났다고 무조건 「시간 초과」라고 하지 않는다 — 그때까지 계속 한도였다면
        //   사용자가 할 일은 「잠시 후 다시」가 아니라 「모델을 바꾸거나 내일」이다.
        const reason: GeminiFailureReason = lastReason === 'quota' ? 'quota' : 'timeout'
        throw new GeminiCallError(reason, hintFor(reason), attempts)
      }

      // 첫 시도는 알리지 않는다 — 정상 동작이지 사건이 아니다.
      if (overall > 0) onAttempt?.({ model, attempt, reason: lastReason })
      overall += 1

      const remaining = Math.max(1_000, Math.min(timeoutMs, deadline - Date.now()))
      const out = await callOnce(model, prompt, apiKey, temperature, remaining, maxOutputTokens, {
        parts, json: cfg.json, onDelta,
      })
      attempts.push(out.detail)

      if (out.kind === 'fatal') {
        // 재시도해도, 모델을 바꿔도 결과가 같은 실패다 — 즉시 원인을 그대로 말하고 끝낸다.
        throw new GeminiCallError(
          out.reason ?? 'server',
          out.reason === 'truncated'
            ? '내용이 길어 AI 응답이 중간에서 끊겼습니다. 나눠서 다시 시도해 주세요.'
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
        // 한도(429)는 같은 모델을 1~2초 뒤에 다시 두드려도 안 풀린다 —
        //   무료 티어는 **하루** 단위다(실측 quotaId …PerProjectPerModel-FreeTier).
        //   백오프에 3초를 버리는 대신 곧바로 다음 모델로 간다. 모델마다 한도 버킷이 따로다.
        //   (실측 v0.7.680: 이 3초 × 모델 4개 × 단계 4개 때문에 한 요청이 90초까지 늘어
        //    Vercel 함수 상한 60초를 넘길 뻔했다 — 그러면 사용자는 아무 말도 못 듣는다.)
        if (out.reason === 'quota') {
          console.warn(`[${feature}] 한도 — 재시도 없이 다음 모델로: ${out.detail}`)
          break
        }
        console.warn(`[${feature}] 재시도(${attempt + 1}/${MAX_RETRIES_PER_MODEL}): ${out.detail}`)
        if (attempt < MAX_RETRIES_PER_MODEL) {
          await sleep(1_000 * 2 ** attempt)
          continue
        }
        break // 이 모델은 포기 — 다음 모델로
      }

      // ok — 형식 검사(accept)가 있으면 여기서 통과해야 성공이다.
      const text = out.text ?? ''
      try {
        const value = cfg.accept ? cfg.accept(text) : text
        quotaBlockedUntil = 0   // Gemini 가 답했다 = 한도가 풀렸다
        const usedFallback = model !== (configured ?? '').trim()
        return {
          value,
          text,
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

  // ── 여기까지 왔다 = Gemini 사슬의 **모든 모델이 실패**했다.
  // 한도(429)는 모델을 바꿔도 안 풀린다 — 무료 티어 한도가 프로젝트 단위로 걸리기 때문이다
  // (실측 2026-08-27: 3개 모델 전부 429, quotaId …PerProjectPerModel-FreeTier, 값 20).
  // 공급자를 바꾸는 것만이 남은 길이다. 호출부가 키를 준 경우에만 간다.
  if (lastReason === 'quota' && !skipGemini) quotaBlockedUntil = Date.now() + QUOTA_COOLDOWN_MS

  if (canFallback) {
    const fb = await callFallbackJson({
      prompt, apiKey: fallbackApiKey!, temperature, maxOutputTokens,
      timeoutMs: Math.max(1_000, Math.min(timeoutMs, deadline - Date.now())),
      feature,
    })
    attempts.push(...(fb.ok ? [`${fb.model}: ok(폴백 공급자)`] : fb.attempts))

    if (fb.ok) {
      try {
        return {
          value: cfg.accept ? cfg.accept(fb.text) : fb.text,
          text: fb.text,
          usage: fb.usage,
          model: fb.model,
          fallbackNotice:
            `Gemini 호출 한도에 걸려 보조 공급자('${fb.model}')로 처리했습니다. ` +
            '한도가 풀리면 자동으로 원래 모델로 돌아갑니다.',
        }
      } catch {
        // 폴백도 JSON을 안 냈다 — 원래 실패 원인을 덮지 않고 아래 공통 경로로 내려간다.
        attempts.push(`${fb.model}: JSON 형식 아님(폴백)`)
      }
    }
  }

  const hint = hintFor(lastReason)

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

/**
 * JSON 응답을 요구하는 Gemini 호출. 설정 모델 → 폴백 모델 순으로 시도하고,
 * 일시적 실패는 지수 백오프로 재시도하며, 응답이 산문이면 그 안의 JSON을 건져낸다.
 *
 * 실패하면 GeminiCallError를 던진다 — 호출처는 `userMessage`를 그대로 화면에 보여주면 된다.
 */
export async function callGeminiJson(opts: CallGeminiJsonOptions): Promise<GeminiJsonResult> {
  const r = await runGeminiChain(opts, { json: true, accept: recoverJson })
  return { value: r.value, usage: r.usage, model: r.model, fallbackNotice: r.fallbackNotice }
}

/**
 * 텍스트 그대로가 필요한 Gemini 호출 — 재시도·모델 폴백·타임아웃은 JSON 호출과 **같다**.
 *
 * 왜 따로 있나(v0.7.678): 응답을 호출부가 직접 파싱해야 하는 자리(스트리밍 미리보기·산문
 * 프롬프트 생성)가 있어서 `callGeminiJson` 만으로는 공용부를 쓸 수 없었다. 그 자리들이
 * 각자 fetch 를 갖고 있었고, 거기에만 안전망이 없었다.
 */
export async function callGeminiText(opts: CallGeminiTextOptions): Promise<GeminiTextResult> {
  const r = await runGeminiChain(opts, { json: opts.responseJson ?? false, accept: null })
  return { text: r.text, usage: r.usage, model: r.model, fallbackNotice: r.fallbackNotice }
}
