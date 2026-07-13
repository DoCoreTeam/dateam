import Anthropic from '@anthropic-ai/sdk'
import type { AiChatCitation } from '@/types/database'
import type {
  ChatProvider,
  ChatTurn,
  StreamChatParams,
  StreamChatResult,
} from '../provider.ts'
import { toClaudeContent } from '../attachments.ts'

const DEFAULT_MAX_OUTPUT_TOKENS = 32000
const DEFAULT_MODEL = 'claude-opus-4-8'
const MAX_PAUSE_RESUMES = 3

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ReturnType<typeof toClaudeContent>
}

/** 순수 함수 (테스트 대상): 턴 → Claude messages. role 보존. 첨부 있으면 멀티모달 블록. */
export function toClaudeMessages(turns: ChatTurn[]): ClaudeMessage[] {
  return turns.map((t) => ({
    role: t.role,
    content: t.attachments?.length ? toClaudeContent(t) : t.content,
  }))
}

// ── web_search 툴 (S3) ──
// opus-4-8 / 4.6+ 계열은 신형 툴 타입, 구모델(claude-3.x)은 폴백.
function webSearchToolVersion(model: string): string {
  return /claude-3/i.test(model) ? 'web_search_20250305' : 'web_search_20260209'
}
function buildWebSearchTool(model: string): Record<string, unknown> {
  return { type: webSearchToolVersion(model), name: 'web_search', max_uses: 5 }
}

/** 출처 URL 스킴 방어(DC-SEC L-2): http/https만 허용. javascript:/data: 등 차단. */
export function isHttpUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** 순수 함수 (테스트 대상): web_search_tool_result 블록의 결과 배열 → AiChatCitation[].
 *  web_search_result(type)만 채택, url 기준 dedupe, title 없으면 url 대체. */
export function mapClaudeWebSearchResults(
  results: unknown,
): AiChatCitation[] {
  if (!Array.isArray(results)) return []
  const out: AiChatCitation[] = []
  const seen = new Set<string>()
  for (const raw of results) {
    const r = raw as { type?: string; url?: string; title?: string }
    if (r?.type && r.type !== 'web_search_result') continue // 에러 항목 등 제외
    const url = typeof r?.url === 'string' ? r.url.trim() : ''
    if (!isHttpUrl(url) || seen.has(url)) continue
    seen.add(url)
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    out.push({ url, title: title || url })
  }
  return out
}

/** 순수 함수 (테스트 대상): text 블록의 단일 citation(web_search_result_location) → AiChatCitation | null. */
export function mapClaudeCitation(citation: unknown): AiChatCitation | null {
  const c = citation as { url?: string; title?: string; cited_text?: string }
  const url = typeof c?.url === 'string' ? c.url.trim() : ''
  if (!isHttpUrl(url)) return null
  const title = typeof c.title === 'string' && c.title.trim() ? c.title.trim() : url
  const snippet = typeof c.cited_text === 'string' && c.cited_text.trim() ? c.cited_text.trim() : undefined
  return snippet ? { url, title, snippet } : { url, title }
}

async function streamChat(params: StreamChatParams): Promise<StreamChatResult> {
  const { apiKey, model, system, turns, maxOutputTokens, signal, tools, onDelta, onThinking, onCitation, onToolStatus } =
    params

  const client = new Anthropic({ apiKey })

  let text = ''
  let thinking = ''
  let promptTokens = 0
  let outputTokens = 0

  const citations: AiChatCitation[] = []
  const seenUrls = new Set<string>()
  const addCitation = (c: AiChatCitation | null) => {
    if (!c || seenUrls.has(c.url)) return
    seenUrls.add(c.url)
    citations.push(c)
    onCitation?.(c)
  }

  const webSearch = tools?.webSearch === true
  const requestTools = webSearch ? [buildWebSearchTool(model || DEFAULT_MODEL)] : undefined

  // pause_turn 재개: 누적 assistant content를 재전송하며 최대 3회
  let convo = toClaudeMessages(turns) as unknown as Anthropic.MessageParam[]
  let pauseResumes = 0
  let searching = false

  try {
    while (true) {
      const stream = client.messages.stream({
        model: model || DEFAULT_MODEL,
        max_tokens: maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ...(system ? { system } : {}),
        messages: convo,
        // adaptive/summarized — 요약 thinking 스트림 수신 (display 미지정 시 omitted 위험)
        thinking: { type: 'adaptive', display: 'summarized' },
        ...(requestTools ? { tools: requestTools as unknown as Anthropic.ToolUnion[] } : {}),
      })

      const onAbort = () => stream.abort()
      signal.addEventListener('abort', onAbort)

      let passOutput = 0
      try {
        for await (const event of stream) {
          if (event.type === 'message_start') {
            promptTokens += event.message.usage.input_tokens ?? 0
            passOutput = event.message.usage.output_tokens ?? passOutput
          } else if (event.type === 'message_delta') {
            passOutput = event.usage.output_tokens ?? passOutput
          } else if (event.type === 'content_block_start') {
            const block = event.content_block as { type?: string; content?: unknown }
            if (block.type === 'server_tool_use') {
              if (!searching) {
                searching = true
                onToolStatus?.('searching')
              }
            } else if (block.type === 'web_search_tool_result') {
              for (const c of mapClaudeWebSearchResults(block.content)) addCitation(c)
              if (searching) {
                searching = false
                onToolStatus?.('done')
              }
            }
          } else if (event.type === 'content_block_delta') {
            const delta = event.delta
            if (delta.type === 'text_delta') {
              text += delta.text
              onDelta(delta.text)
            } else if (delta.type === 'thinking_delta') {
              thinking += delta.thinking
              onThinking?.(delta.thinking)
            } else if (delta.type === 'citations_delta') {
              addCitation(mapClaudeCitation((delta as { citation?: unknown }).citation))
            }
          }
        }

        outputTokens += passOutput

        const final = await stream.finalMessage()
        if (final.stop_reason === 'pause_turn' && pauseResumes < MAX_PAUSE_RESUMES) {
          // 누적 assistant content(server_tool_use·result 블록 포함)를 그대로 재전송해 재개
          convo = [...convo, { role: 'assistant', content: final.content }]
          pauseResumes += 1
          continue
        }
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
      break
    }
  } catch (err) {
    if (searching) onToolStatus?.('done')
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return {
        text,
        thinking: thinking || null,
        usage: { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens },
        stopped: true,
        citations,
      }
    }
    throw err
  }

  return {
    text,
    thinking: thinking || null,
    usage: { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens },
    stopped: signal.aborted,
    citations,
  }
}

async function listModels(apiKey: string): Promise<string[]> {
  const client = new Anthropic({ apiKey })
  const out: string[] = []
  for await (const m of client.models.list()) {
    out.push(m.id)
  }
  return out
}

export const claudeProvider: ChatProvider = {
  id: 'claude',
  label: 'Claude',
  capabilities: {
    vision: true,
    tools: true,
    thinking: true,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  },
  streamChat,
  listModels,
}
