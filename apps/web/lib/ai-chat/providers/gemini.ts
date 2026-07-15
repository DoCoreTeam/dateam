import type { AiChatCitation } from '@/types/database'
import type {
  ChatProvider,
  ChatTurn,
  StreamChatParams,
  StreamChatResult,
} from '../provider.ts'
import { createSseParser } from '../sse.ts'
import { toGeminiParts } from '../attachments.ts'
import { isHttpUrl } from './claude.ts'

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

/** 순수 함수 (테스트 대상): groundingChunks[] → AiChatCitation[].
 *  web.uri 기준 dedupe, web 없는 청크 skip, title 없으면 uri 대체. */
export function mapGeminiGroundingChunks(chunks: unknown): AiChatCitation[] {
  if (!Array.isArray(chunks)) return []
  const out: AiChatCitation[] = []
  const seen = new Set<string>()
  for (const raw of chunks) {
    const web = (raw as { web?: { uri?: string; title?: string } })?.web
    const uri = typeof web?.uri === 'string' ? web.uri.trim() : ''
    if (!isHttpUrl(uri) || seen.has(uri)) continue
    seen.add(uri)
    const title = typeof web?.title === 'string' && web.title.trim() ? web.title.trim() : uri
    out.push({ url: uri, title })
  }
  return out
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    groundingMetadata?: { groundingChunks?: unknown }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

async function streamChat(params: StreamChatParams): Promise<StreamChatResult> {
  const { apiKey, model, system, turns, maxOutputTokens, signal, tools, onDelta, onCitation, onToolStatus } = params

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
  const body: Record<string, unknown> = {
    contents: toGeminiContents(turns),
    generationConfig: { maxOutputTokens: maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS },
  }
  if (system) body.system_instruction = { parts: [{ text: system }] }
  const webSearch = tools?.webSearch === true
  if (webSearch) body.tools = [{ google_search: {} }]

  let text = ''
  let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

  const citations: AiChatCitation[] = []
  const seenUrls = new Set<string>()
  let searchDone = false
  const harvestCitations = (chunk: GeminiStreamChunk) => {
    const grounding = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks
    for (const c of mapGeminiGroundingChunks(grounding)) {
      if (seenUrls.has(c.url)) continue
      seenUrls.add(c.url)
      citations.push(c)
      onCitation?.(c)
      if (!searchDone) {
        searchDone = true
        onToolStatus?.('done')
      }
    }
  }

  try {
    if (webSearch) onToolStatus?.('searching')

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
        harvestCitations(gc)
        const delta = gc.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        if (delta) {
          text += delta
          onDelta(delta)
        }
      }
    }
    for (const ev of parser.flush()) {
      const gc = ev as GeminiStreamChunk
      harvestCitations(gc)
      const delta = gc.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (delta) {
        text += delta
        onDelta(delta)
      }
    }
    if (webSearch && !searchDone) onToolStatus?.('done')
  } catch (err) {
    if (webSearch && !searchDone) onToolStatus?.('done')
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return { text, thinking: null, usage, stopped: true, citations }
    }
    throw err
  }

  return { text, thinking: null, usage, stopped: false, citations }
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

/** 실사용 프로브: 최소 페이로드로 generateContent(비스트리밍) 1회 호출.
 *  200 = usable. 404/400(모델없음·미지원)·429(limit: 0, 요금제 할당량 0) = usable:false(근본 미사용).
 *  그 외(일시 429·5xx·네트워크 오류)는 usable:true — 일시 장애로 모델을 벌하지 않는다. */
async function probeModel(apiKey: string, model: string): Promise<{ usable: boolean }> {
  try {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
      cache: 'no-store',
    })
    if (res.ok) return { usable: true }
    if (res.status === 404 || res.status === 400) return { usable: false }
    if (res.status === 429) {
      const bodyText = await res.text().catch(() => '')
      if (bodyText.toLowerCase().includes('limit: 0')) return { usable: false }
      return { usable: true } // 일시 레이트리밋
    }
    return { usable: true } // 5xx 등 일시 장애
  } catch {
    return { usable: true } // 네트워크 오류 등 — 관대하게 처리(기존 동작 보존)
  }
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
  probeModel,
}
