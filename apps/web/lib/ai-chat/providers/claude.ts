import Anthropic from '@anthropic-ai/sdk'
import type {
  ChatProvider,
  ChatTurn,
  StreamChatParams,
  StreamChatResult,
} from '../provider.ts'
import { toClaudeContent } from '../attachments.ts'

const DEFAULT_MAX_OUTPUT_TOKENS = 32000
const DEFAULT_MODEL = 'claude-opus-4-8'

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

async function streamChat(params: StreamChatParams): Promise<StreamChatResult> {
  const { apiKey, model, system, turns, maxOutputTokens, signal, onDelta, onThinking } =
    params

  const client = new Anthropic({ apiKey })

  let text = ''
  let thinking = ''
  let promptTokens = 0
  let outputTokens = 0

  const stream = client.messages.stream({
    model: model || DEFAULT_MODEL,
    max_tokens: maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(system ? { system } : {}),
    messages: toClaudeMessages(turns) as unknown as Anthropic.MessageParam[],
    // adaptive/summarized — 요약 thinking 스트림 수신 (display 미지정 시 omitted 위험)
    thinking: { type: 'adaptive', display: 'summarized' },
  })

  const onAbort = () => stream.abort()
  signal.addEventListener('abort', onAbort)

  try {
    for await (const event of stream) {
      if (event.type === 'message_start') {
        promptTokens = event.message.usage.input_tokens ?? 0
        outputTokens = event.message.usage.output_tokens ?? outputTokens
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens ?? outputTokens
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta
        if (delta.type === 'text_delta') {
          text += delta.text
          onDelta(delta.text)
        } else if (delta.type === 'thinking_delta') {
          thinking += delta.thinking
          onThinking?.(delta.thinking)
        }
      }
    }
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return {
        text,
        thinking: thinking || null,
        usage: { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens },
        stopped: true,
      }
    }
    throw err
  } finally {
    signal.removeEventListener('abort', onAbort)
  }

  return {
    text,
    thinking: thinking || null,
    usage: { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens },
    stopped: signal.aborted,
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
