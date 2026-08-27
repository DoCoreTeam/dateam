// lib/ai/fallback-text.ts — Gemini 사슬이 전부 막혔을 때 쓰는 **두 번째 공급자**
//
// 왜 생겼나 (실측 2026-08-27):
//   조직의 Gemini 키가 무료 티어였다. API가 그렇게 답한다 —
//   `generate_content_free_tier_requests` / `GenerateRequestsPerDayPerProjectPerModel-FreeTier`
//   / quotaValue **20**. 즉 **모델당 하루 20회**다. 그런데 CI 발견은 떡상 1건당 1회를 부르므로
//   주제 하나만 돌려도 그날 예산이 끝난다. 그리고 키를 공유하는 회의노트·CRM·GPU가 함께 죽는다.
//
//   모델 폴백(gemini-model.ts)은 이 상황을 못 푼다. 한도가 **모델별**이 아니라
//   **프로젝트별로 모델마다** 걸려 있어서, 모델을 바꿔도 같은 프로젝트면 같이 소진된다.
//   실측: gemini-3-flash-preview · gemini-3.6-flash · gemini-3.1-pro-preview 전부 429.
//
// 그래서 **공급자**를 바꾼다. 조직이 이미 쓰는 Groq 계정(회의 녹음 STT)을 그대로 쓴다.
//   - 새 계약·새 결제가 없다. 키가 이미 있고 이미 이 조직의 데이터가 가는 곳이다.
//   - 보내는 것은 공개된 유튜브 제목·설명이다. 회의 녹음보다 민감도가 낮다.
//   - OpenAI 호환 엔드포인트라 요청 모양이 표준이다.
//
// 이 파일은 **폴백일 뿐이다.** Gemini가 살아 있으면 여기까지 오지 않는다.
// 끄는 법: `getGeminiMeta()`가 `fallbackApiKey`를 빈 값으로 돌려주게 하거나,
//          시스템 설정에서 `stt_api_key`/`groq_api_key`를 지우면 된다(그러면 STT도 멈춘다).

const FALLBACK_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * 폴백 모델 사슬. 실측(2026-08-27) 이 키로 목록에 뜨는 것 중 JSON 지시를 따르는 순서.
 *
 * 앞의 것이 막히면 다음으로 간다 — Gemini 쪽과 같은 규칙이다.
 */
export const FALLBACK_MODELS: readonly string[] = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
]

export interface FallbackUsage { prompt: number; output: number; total: number }

export type FallbackOutcome =
  | { ok: true; text: string; model: string; usage: FallbackUsage }
  | { ok: false; attempts: string[] }

/**
 * OpenAI 호환 응답에서 본문을 꺼낸다.
 *
 * 순수 함수로 분리한 이유: 응답 모양이 바뀌면 조용히 빈 문자열이 되고,
 * 그러면 호출부는 "AI가 답을 안 줬다"로 읽는다. 그 경계를 테스트로 잠근다.
 */
export function extractChoiceText(json: unknown): string {
  const j = json as { choices?: { message?: { content?: unknown } }[] } | null
  const raw = j?.choices?.[0]?.message?.content
  return typeof raw === 'string' ? raw : ''
}

/** OpenAI 호환 usage를 우리 모양으로 옮긴다. 없으면 0 — 지어내지 않는다. */
export function extractUsage(json: unknown): FallbackUsage {
  const u = (json as { usage?: Record<string, unknown> } | null)?.usage
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    prompt: num(u?.prompt_tokens),
    output: num(u?.completion_tokens),
    total: num(u?.total_tokens),
  }
}

/**
 * 폴백 공급자에게 JSON을 요구하는 한 번의 호출(모델 사슬 포함).
 *
 * 던지지 않는다 — 여기까지 온 시점에 이미 Gemini가 실패한 상태라,
 * 여기서 또 던지면 원래 실패 원인이 폴백 실패에 가려진다. 실패는 attempts로 돌려준다.
 */
export async function callFallbackJson(opts: {
  prompt: string
  apiKey: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  feature?: string
}): Promise<FallbackOutcome> {
  const { prompt, apiKey, temperature = 0.2, maxOutputTokens = 8_192, timeoutMs = 60_000 } = opts
  const attempts: string[] = []
  if (!apiKey) return { ok: false, attempts: ['폴백 공급자 키 없음'] }

  for (const model of FALLBACK_MODELS) {
    let res: Response
    try {
      res = await fetch(FALLBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxOutputTokens,
          response_format: { type: 'json_object' },
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      attempts.push(`${model}: 네트워크/시간초과(${(e as Error).message})`)
      continue
    }

    if (!res.ok) {
      attempts.push(`${model}: HTTP ${res.status}`)
      // 인증 실패는 모델을 바꿔도 같다 — 사슬을 더 돌지 않는다.
      if (res.status === 401 || res.status === 403) break
      continue
    }

    const json = (await res.json().catch(() => null)) as unknown
    const text = extractChoiceText(json)
    if (!text) { attempts.push(`${model}: 응답이 비어 있음`); continue }

    return { ok: true, text, model, usage: extractUsage(json) }
  }

  return { ok: false, attempts }
}
