// lib/ci/ai/gemini.ts — Gemini 호출 (CI 전용 얇은 래퍼)
// 키·모델은 기존 org_content META를 재사용한다(lib/ci/ai/meta.ts).
// 실패를 예외로 던지지 않는다 — 호출자가 폴백을 고를 수 있어야 한다.

const API_HOST = 'https://generativelanguage.googleapis.com'
const TIMEOUT_MS = 60_000

/** 미디어 파트를 Gemini가 받는 모양으로. 원격은 camelCase가 아니면 통째로 무시된다. */
function toApiPart(p: GeminiPart): Record<string, unknown> {
  return p.kind === 'remote'
    ? { fileData: p.mimeType ? { fileUri: p.uri, mimeType: p.mimeType } : { fileUri: p.uri } }
    : { inlineData: { mimeType: p.mimeType, data: p.data } }
}

export type GeminiResult =
  | { ok: true; text: string; promptTokens: number; outputTokens: number }
  | { ok: false; error: string }

/**
 * 프롬프트에 함께 실어 보낼 것. 텍스트 말고 실제 미디어를 넘길 때 쓴다.
 *  - remote: 모델이 직접 가져가는 주소 (YouTube 공개 영상 등)
 *  - inline: 우리가 받아서 base64로 실어 보내는 것 (썸네일 등)
 */
export type GeminiPart =
  | { kind: 'remote'; uri: string; mimeType?: string }
  | { kind: 'inline'; mimeType: string; data: string }

interface CallInput {
  apiKey: string
  model: string
  prompt: string
  temperature?: number
  signal?: AbortSignal
  /**
   * 함께 보낼 미디어. 없으면 예전과 완전히 같은 요청이 나간다.
   */
  parts?: GeminiPart[]
  /**
   * API 버전. 원격 미디어(fileData)는 v1beta가 404로 거절하므로 v1alpha가 필요하다.
   * (실측 2026-08-18: v1beta + fileData → HTTP 404 빈 본문 / v1alpha → 200 + VIDEO 4,997토큰)
   * 지정하지 않으면 예전 그대로 v1beta로 나간다.
   */
  apiVersion?: 'v1beta' | 'v1alpha'
  /** 영상은 오래 걸린다. 지정하지 않으면 기존 60초. */
  timeoutMs?: number
  /**
   * 출력 토큰 상한. 대사 전문 + 자막 수십 줄을 받으면 기본값에서 **잘려서 JSON이 깨진다**
   * (실측 2026-08-18: 21건 중 1건이 그렇게 실패). 지정하지 않으면 모델 기본값 그대로다.
   */
  maxOutputTokens?: number
}

export async function callGemini(input: CallInput): Promise<GeminiResult> {
  if (!input.apiKey) return { ok: false, error: 'AI 키가 설정되지 않았습니다' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? TIMEOUT_MS)
  input.signal?.addEventListener('abort', () => controller.abort())

  const version = input.apiVersion ?? 'v1beta'
  const parts: Record<string, unknown>[] = [{ text: input.prompt }]
  for (const p of input.parts ?? []) parts.push(toApiPart(p))

  try {
    const res = await fetch(
      `${API_HOST}/${version}/models/${encodeURIComponent(input.model)}:generateContent?key=${input.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: input.temperature ?? 0.4,
            ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
          },
        }),
      },
    )

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `AI 응답 실패 (${res.status}) ${body.slice(0, 200)}` }
    }

    const json = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text.trim()) return { ok: false, error: 'AI가 빈 응답을 돌려주었습니다' }

    // 길이 상한에 걸려 잘린 응답은 JSON이 깨진 채로 온다.
    // "형식이 이상하다"가 아니라 "길어서 잘렸다"라고 말해야 상한을 올릴 수 있다.
    const finish = json.candidates?.[0]?.finishReason
    if (finish === 'MAX_TOKENS') {
      return { ok: false, error: 'AI 응답이 길이 상한에 걸려 잘렸습니다' }
    }

    return {
      ok: true,
      text,
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError'
      ? 'AI 응답이 시간 안에 오지 않았습니다'
      : 'AI를 호출하지 못했습니다'
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
