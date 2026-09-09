// OpenAI 호환 어댑터 팩토리
//
// OpenAI 와 Groq 과 Grok 은 같은 말을 쓴다 — /chat/completions, /models, 같은 스트림 모양.
// 다른 것은 주소 하나뿐이다. 그래서 어댑터를 세 벌 쓰지 않고 이 팩토리를 세 번 부른다.
//
// 능력(이미지 읽기·도구·생각)은 여기서 정하지 않는다. 명세(lib/ai/provider-catalog)에서 온다 —
// 어댑터가 자기 값을 또 적으면 카드에 쓰인 능력과 실제 호출이 갈린다.

import OpenAI from 'openai'
import type { ChatProvider, StreamChatParams, StreamChatResult, ProbeModelResult } from '../provider.ts'
import { toOpenAiMessages } from './openai-messages.ts'
import { classifyModelProbeFailure, getProviderErrorDetail } from '../probe-result.ts'
import { getProviderSpec, type AiProviderId } from '../../ai/provider-catalog.ts'

export interface OpenAiCompatibleOptions {
  /** 명세의 공급자 id. 라벨과 능력과 주소를 여기서 읽는다 */
  id: AiProviderId
  /**
   * 모델 목록에서 채팅 모델만 고르는 정규식.
   * 공급자마다 이름 규칙이 달라 이것만은 팩토리 인자로 받는다
   * (Groq 은 목록에 whisper 전사 모델이 섞여 나온다)
   */
  chatModelPattern: RegExp
}

/**
 * 명세 하나로 ChatProvider 한 벌을 만든다.
 * baseUrl 이 null 인 공급자(공식 SDK 를 쓰는 쪽)는 SDK 기본 주소로 간다.
 */
export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): ChatProvider {
  const spec = getProviderSpec(opts.id)
  // baseUrl 이 null 이면 undefined 로 넘겨 SDK 기본값을 쓴다. null 을 그대로 주면 SDK 가 던진다.
  const baseURL = spec.baseUrl ?? undefined

  const client = (apiKey: string) => new OpenAI({ apiKey, baseURL })

  async function streamChat(params: StreamChatParams): Promise<StreamChatResult> {
    const { apiKey, model, system, turns, maxOutputTokens, signal, onDelta } = params

    let text = ''
    let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

    try {
      const stream = await client(apiKey).chat.completions.create(
        {
          model,
          messages: toOpenAiMessages(system, turns) as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: maxOutputTokens ?? spec.capabilities.defaultMaxOutputTokens,
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
    const out: string[] = []
    for await (const m of client(apiKey).models.list()) {
      if (opts.chatModelPattern.test(m.id)) out.push(m.id)
    }
    return out.sort()
  }

  async function probeModel(apiKey: string, model: string): Promise<ProbeModelResult> {
    try {
      await client(apiKey).chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_completion_tokens: 16,
      })
      return { usable: true, availability: 'available', reason: null }
    } catch (error) {
      const { status, detail, code } = getProviderErrorDetail(error)
      return classifyModelProbeFailure(spec.label, status, detail, code)
    }
  }

  return {
    id: spec.id as ChatProvider['id'],
    label: spec.label,
    capabilities: spec.capabilities,
    streamChat,
    listModels,
    probeModel,
  }
}
