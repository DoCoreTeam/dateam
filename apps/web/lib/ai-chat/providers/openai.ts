import OpenAI from 'openai'
import type {
  ChatProvider,
  ChatTurn,
  StreamChatParams,
  StreamChatResult,
} from '../provider.ts'

const DEFAULT_MAX_OUTPUT_TOKENS = 16384

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 순수 함수 (테스트 대상): system을 첫 원소로, 이어서 턴. system 없으면 미포함. */
export function toOpenAiMessages(
  system: string | undefined,
  turns: ChatTurn[],
): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const t of turns) out.push({ role: t.role, content: t.content })
  return out
}

async function streamChat(params: StreamChatParams): Promise<StreamChatResult> {
  const { apiKey, model, system, turns, maxOutputTokens, signal, onDelta } = params

  const client = new OpenAI({ apiKey })

  let text = ''
  let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        messages: toOpenAiMessages(system, turns),
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      },
      { signal },
    )

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        text += delta
        onDelta(delta)
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        }
      }
    }
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === 'APIUserAbortError')) {
      return { text, thinking: null, usage, stopped: true }
    }
    throw err
  }

  return { text, thinking: null, usage, stopped: signal.aborted }
}

async function listModels(apiKey: string): Promise<string[]> {
  const client = new OpenAI({ apiKey })
  const out: string[] = []
  for await (const m of client.models.list()) {
    if (/^(gpt|o\d|chatgpt)/i.test(m.id)) out.push(m.id)
  }
  return out.sort()
}

export const openaiProvider: ChatProvider = {
  id: 'openai',
  label: 'OpenAI',
  capabilities: {
    vision: true,
    tools: false,
    thinking: false,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  },
  streamChat,
  listModels,
}
