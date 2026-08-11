// lib/ci/ai/gemini.ts — Gemini 호출 (CI 전용 얇은 래퍼)
// 키·모델은 기존 org_content META를 재사용한다(lib/ci/ai/meta.ts).
// 실패를 예외로 던지지 않는다 — 호출자가 폴백을 고를 수 있어야 한다.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const TIMEOUT_MS = 60_000

export type GeminiResult =
  | { ok: true; text: string; promptTokens: number; outputTokens: number }
  | { ok: false; error: string }

interface CallInput {
  apiKey: string
  model: string
  prompt: string
  temperature?: number
  signal?: AbortSignal
}

export async function callGemini(input: CallInput): Promise<GeminiResult> {
  if (!input.apiKey) return { ok: false, error: 'AI 키가 설정되지 않았습니다' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  input.signal?.addEventListener('abort', () => controller.abort())

  try {
    const res = await fetch(
      `${API_BASE}/models/${encodeURIComponent(input.model)}:generateContent?key=${input.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: input.prompt }] }],
          generationConfig: { temperature: input.temperature ?? 0.4 },
        }),
      },
    )

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `AI 응답 실패 (${res.status}) ${body.slice(0, 200)}` }
    }

    const json = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text.trim()) return { ok: false, error: 'AI가 빈 응답을 돌려주었습니다' }

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
