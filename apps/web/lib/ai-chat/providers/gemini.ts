import type {
  ChatProvider,
  ChatTurn,
  StreamChatParams,
  StreamChatResult,
} from '../provider.ts'
import { createSseParser } from '../sse.ts'
import { toGeminiParts } from '../attachments.ts'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MAX_OUTPUT_TOKENS = 8192

interface GeminiContent {
  role: 'user' | 'model'
  parts: ReturnType<typeof toGeminiParts>
}

/** 순수 함수 (테스트 대상): 턴 → Gemini contents. assistant→'model' 매핑. 첨부 있으면 inline_data. */
export function toGeminiContents(turns: ChatTurn[]): GeminiContent[] {
  return turns.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: toGeminiParts(t),
  }))
}

interface GeminiStreamChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

async function streamChat(params: StreamChatParams): Promise<StreamChatResult> {
  const { apiKey, model, system, turns, maxOutputTokens, signal, onDelta } = params

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
  const body: Record<string, unknown> = {
    contents: toGeminiContents(turns),
    generationConfig: { maxOutputTokens: maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS },
  }
  if (system) body.system_instruction = { parts: [{ text: system }] }

  let text = ''
  let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok || !res.body) {
      throw new Error(`Gemini API 오류 (${res.status})`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseParser()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const events = parser.push(decoder.decode(value, { stream: true }))
      for (const ev of events) {
        const gc = ev as GeminiStreamChunk
        if (gc.usageMetadata) {
          usage = {
            promptTokens: gc.usageMetadata.promptTokenCount ?? usage.promptTokens,
            outputTokens: gc.usageMetadata.candidatesTokenCount ?? usage.outputTokens,
            totalTokens: gc.usageMetadata.totalTokenCount ?? usage.totalTokens,
          }
        }
        const delta = gc.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        if (delta) {
          text += delta
          onDelta(delta)
        }
      }
    }
    for (const ev of parser.flush()) {
      const gc = ev as GeminiStreamChunk
      const delta = gc.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (delta) {
        text += delta
        onDelta(delta)
      }
    }
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return { text, thinking: null, usage, stopped: true }
    }
    throw err
  }

  return { text, thinking: null, usage, stopped: false }
}

async function listModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${GEMINI_API_BASE}/models`, {
    headers: { 'x-goog-api-key': apiKey },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Gemini 모델 목록 오류 (${res.status})`)
  const json = (await res.json()) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[]
  }
  return (json.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
}

export const geminiProvider: ChatProvider = {
  id: 'gemini',
  label: 'Gemini',
  capabilities: {
    vision: true,
    tools: true,
    thinking: false,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  },
  streamChat,
  listModels,
}
