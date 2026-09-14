// OpenAI 호환 어댑터 팩토리
//
// OpenAI 와 Groq 과 Grok 은 같은 말을 쓴다 — /chat/completions, /models, 같은 스트림 모양.
// 다른 것은 주소 하나뿐이다. 그래서 어댑터를 세 벌 쓰지 않고 이 팩토리를 세 번 부른다.
//
// 능력(이미지 읽기·도구·생각)은 여기서 정하지 않는다. 명세(lib/ai/provider-catalog)에서 온다 —
// 어댑터가 자기 값을 또 적으면 카드에 쓰인 능력과 실제 호출이 갈린다.

import OpenAI from 'openai'
import type { ChatProvider, StreamChatParams, StreamChatResult, ProbeModelResult, ListedModelFacts } from '../provider.ts'
import { toOpenAiMessages } from './openai-messages.ts'
import { classifyModelProbeFailure, getProviderErrorDetail } from '../probe-result.ts'
import { getProviderSpec, type AiProviderId } from '../../ai/provider-catalog.ts'

/**
 * 공급자가 /models 로 내려주는 한 줄.
 *
 * id 말고는 공급자마다 주는 것이 다르다 — Groq 은 무엇을 먹고 무엇을 뱉는지까지 알려주고,
 * OpenAI 는 id 와 주인만 준다. 주는 쪽이 답을 갖고 있으면 그 답을 쓴다.
 */
export interface ListedModel {
  id: string
  /** 한 번에 넣을 수 있는 토큰 수 (Groq 이 준다) */
  context_window?: number
  /** 이 모델이 무엇을 뱉는가. text / speech / transcription (Groq 이 준다) */
  output_modalities?: string[]
  /** 이 모델이 무엇을 먹는가. text / image / audio (Groq 이 준다) */
  input_modalities?: string[]
}

export interface OpenAiCompatibleOptions {
  /** 명세의 공급자 id. 라벨과 능력과 주소를 여기서 읽는다 */
  id: AiProviderId
  /**
   * 목록에서 채팅 모델만 고른다.
   *
   * 정규식이 아니라 모델 한 줄을 통째로 받는다 — 이름만 보면 짐작이 되고, 짐작은 틀린다.
   * 실측(2026-09-14): 이름 규칙이 Groq 14개 중 5개만 통과시켜 groq/compound 와
   * allam-2-7b 같은 진짜 채팅 모델을 버리고 있었다.
   */
  selectChatModel(model: ListedModel): boolean
}

/** 공급자가 무엇을 뱉는지 말해 주지 않을 때 쓰는 이름 규칙 */
export function byNamePattern(pattern: RegExp) {
  return (model: ListedModel): boolean => pattern.test(model.id)
}

/**
 * 공급자가 스스로 답한 것으로 고른다. 말 상대가 되는 모델은 글을 뱉는다 —
 * 소리를 뱉으면 읽어 주는 모델이고, 받아쓰기를 뱉으면 전사 모델이다.
 * 답을 안 주는 공급자는 준비해 둔 이름 규칙으로 떨어진다.
 */
export function byOutputModality(fallback: RegExp) {
  return (model: ListedModel): boolean => {
    const out = model.output_modalities
    if (!out || out.length === 0) return fallback.test(model.id)
    return out.includes('text')
  }
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
      // SDK 타입에는 id 밖에 없지만 공급자는 더 준다. 주는 것을 버리지 않는다
      if (opts.selectChatModel(m as unknown as ListedModel)) out.push(m.id)
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

  /** 공급자가 준 사실을 그대로 넘긴다. 여기서 짐작을 섞지 않는다 */
  async function describeModels(apiKey: string): Promise<ListedModelFacts[]> {
    const out: ListedModelFacts[] = []
    for await (const m of client(apiKey).models.list()) {
      const listed = m as unknown as ListedModel
      if (!opts.selectChatModel(listed)) continue
      out.push({
        id: listed.id,
        inputModalities: listed.input_modalities,
        outputModalities: listed.output_modalities,
        contextWindow: listed.context_window,
      })
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  return {
    id: spec.id as ChatProvider['id'],
    label: spec.label,
    capabilities: spec.capabilities,
    streamChat,
    listModels,
    describeModels,
    probeModel,
  }
}
