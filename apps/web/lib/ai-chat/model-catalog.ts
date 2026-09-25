// 모델 카탈로그(⑤) — 큐레이션 기본 능력/출시일 맵 + 병합 헬퍼(순수 함수, 단위테스트 대상).
// DB(ai_model_catalog, 마이그 156)의 시드값과 동일 데이터를 코드에도 유지 — refreshModelCatalog가
// 실 프로바이더 응답(listModels)으로 model_id를 upsert할 때 capabilities/released_at 보완에 사용.
import type { AiChatProviderId } from '@/types/database'
import { getProviderSpec } from '../ai/provider-catalog.ts'
import type { ListedModelFacts } from './provider.ts'

export interface ModelCapabilities {
  vision: boolean
  longContext: boolean
  reasoning: boolean
}

export interface CuratedModelInfo {
  label: string
  contextLength?: number
  capabilities: ModelCapabilities
  releasedAt?: string // YYYY-MM-DD
}

const DEFAULT_CAPS: ModelCapabilities = { vision: false, longContext: false, reasoning: false }

/** 「긴 컨텍스트」라고 부르는 문턱. 공급자가 길이를 말해 주면 이름 대신 이 숫자로 판단한다 */
const LONG_CONTEXT_TOKENS = 100_000

// DB seed(156_ai_model_catalog.sql)와 동일 값 — 두 곳 중 하나만 바뀌면 표시가 어긋나므로 함께 갱신할 것.
export const CURATED_MODELS: Record<AiChatProviderId, Record<string, CuratedModelInfo>> = {
  gemini: {
    'gemini-2.0-flash': { label: 'Gemini 2.0 Flash', contextLength: 1048576, capabilities: { vision: true, longContext: true, reasoning: false }, releasedAt: '2025-02-05' },
    'gemini-1.5-pro': { label: 'Gemini 1.5 Pro', contextLength: 2097152, capabilities: { vision: true, longContext: true, reasoning: true }, releasedAt: '2024-05-14' },
    'gemini-1.5-flash': { label: 'Gemini 1.5 Flash', contextLength: 1048576, capabilities: { vision: true, longContext: true, reasoning: false }, releasedAt: '2024-05-14' },
  },
  claude: {
    'claude-opus-4-8': { label: 'Claude Opus 4.8', contextLength: 200000, capabilities: { vision: true, longContext: false, reasoning: true }, releasedAt: '2026-05-01' },
    'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6', contextLength: 200000, capabilities: { vision: true, longContext: false, reasoning: true }, releasedAt: '2026-02-01' },
    'claude-sonnet-4': { label: 'Claude Sonnet 4', contextLength: 200000, capabilities: { vision: true, longContext: false, reasoning: true }, releasedAt: '2025-05-14' },
    'claude-3-5-sonnet-20241022': { label: 'Claude 3.5 Sonnet', contextLength: 200000, capabilities: { vision: true, longContext: false, reasoning: false }, releasedAt: '2024-10-22' },
  },
  openai: {
    'gpt-4o': { label: 'GPT-4o', contextLength: 128000, capabilities: { vision: true, longContext: false, reasoning: false }, releasedAt: '2024-05-13' },
    'gpt-4o-mini': { label: 'GPT-4o mini', contextLength: 128000, capabilities: { vision: true, longContext: false, reasoning: false }, releasedAt: '2024-07-18' },
    o1: { label: 'o1', contextLength: 200000, capabilities: { vision: true, longContext: false, reasoning: true }, releasedAt: '2024-12-05' },
    'o3-mini': { label: 'o3-mini', contextLength: 200000, capabilities: { vision: false, longContext: false, reasoning: true }, releasedAt: '2025-01-31' },
  },
  groq: {
    'llama-3.3-70b-versatile': { label: 'Llama 3.3 70B', contextLength: 131072, capabilities: { vision: false, longContext: true, reasoning: false }, releasedAt: '2024-12-06' },
    'llama-3.1-8b-instant': { label: 'Llama 3.1 8B', contextLength: 131072, capabilities: { vision: false, longContext: true, reasoning: false }, releasedAt: '2024-07-23' },
    'qwen-2.5-32b': { label: 'Qwen 2.5 32B', contextLength: 131072, capabilities: { vision: false, longContext: true, reasoning: false }, releasedAt: '2024-09-19' },
  },
  grok: {
    'grok-4': { label: 'Grok 4', contextLength: 256000, capabilities: { vision: true, longContext: true, reasoning: true }, releasedAt: '2025-07-09' },
    'grok-3': { label: 'Grok 3', contextLength: 131072, capabilities: { vision: true, longContext: true, reasoning: true }, releasedAt: '2025-02-17' },
    'grok-3-mini': { label: 'Grok 3 mini', contextLength: 131072, capabilities: { vision: false, longContext: true, reasoning: true }, releasedAt: '2025-02-17' },
  },  /**
   * 관문이라 뒤에 390개가 있다(2026-09-26 `/v1/models` 실측). 전부 적을 수도 없고,
   * 적어 두면 벤더가 뺀 날 화면만 그대로 남는다. 그래서 **고르기 시작점 셋**만 둔다 —
   * 값은 그날 관문이 실제로 돌려준 것이고(문맥 길이·출시일 포함), 나머지는 모델 목록 갱신이 채운다.
   */
  jev: {
    'openai/gpt-5-mini': { label: 'GPT-5 mini (관문)', contextLength: 400000, capabilities: { vision: true, longContext: true, reasoning: true }, releasedAt: '2025-08-07' },
    'anthropic/claude-sonnet-5': { label: 'Claude Sonnet 5 (관문)', contextLength: 1000000, capabilities: { vision: true, longContext: true, reasoning: true }, releasedAt: '2026-06-29' },
    'google/gemini-2.5-flash': { label: 'Gemini 2.5 Flash (관문)', contextLength: 1000000, capabilities: { vision: true, longContext: true, reasoning: true }, releasedAt: '2025-03-20' },
  },

}

export interface ModelCatalogEntry {
  provider: AiChatProviderId
  modelId: string
  label: string
  contextLength: number | null
  capabilities: ModelCapabilities
  releasedAt: string | null
  isActive: boolean
}

export interface ExistingCatalogRow {
  label?: string | null
  contextLength?: number | null
  capabilities?: Partial<ModelCapabilities> | null
  releasedAt?: string | null
}

/**
 * DB 기존 행(있으면) + 큐레이션 맵을 병합해 카탈로그 upsert용 완전한 엔트리를 만든다.
 * 기존값 우선 보존(널로 덮어쓰지 않음) → 큐레이션으로 보완 → 그래도 없으면 안전한 기본값.
 */
export function mergeModelCatalogEntry(
  provider: AiChatProviderId,
  modelId: string,
  existing?: ExistingCatalogRow | null,
  /** 공급자가 이 모델에 대해 말해 준 것. 큐레이션보다도 위다 — 우리 표는 낡고 공급자는 지금을 안다 */
  facts?: ListedModelFacts | null,
): ModelCatalogEntry {
  const curated = CURATED_MODELS[provider]?.[modelId]
  const inferred = inferModelMeta(provider, modelId, facts) // 큐레이션에 없는 라이브 모델 보완(빈칸 방지)
  return {
    provider,
    modelId,
    label: existing?.label ?? curated?.label ?? inferred.label,
    // 공급자가 지금 말해 준 길이가 우리 표보다 정확하다. 그것이 없을 때만 기존값과 큐레이션으로 간다
    contextLength: facts?.contextWindow ?? existing?.contextLength ?? curated?.contextLength ?? inferred.contextLength ?? null,
    capabilities: {
      ...DEFAULT_CAPS,
      ...inferred.capabilities,       // 추론이 최하위
      ...curated?.capabilities,       // 큐레이션이 그 위
      ...(existing?.capabilities ?? {}), // 기존 DB값이 그 위
      // 공급자가 지금 말해 준 것이 맨 위다. 우리 표도 DB 도 낡을 수 있고 공급자는 지금을 안다
      ...(facts?.inputModalities ? { vision: facts.inputModalities.includes('image') } : {}),
    },
    releasedAt: existing?.releasedAt ?? curated?.releasedAt ?? inferred.releasedAt ?? null,
    isActive: true,
  }
}

// 비채팅 모델(임베딩·TTS·이미지생성 등)은 모델 선택에서 제외. `-image`/`banana`=이미지 생성 모델.
// Groq 은 모델 목록에 회의 전사용 whisper 를 섞어 준다 — 그것이 채팅 모델 고르는 칸에 뜨면
// 고를 수는 있는데 말은 못 하는 모델이 목록에 앉는다.
const NON_CHAT_RE = /(embedding|aqa|tts|imagen|image-generation|image-gen|-image|banana|veo|whisper|dall-e|audio|realtime|moderation|rerank)/i
export function isChatModel(_provider: AiChatProviderId, modelId: string): boolean {
  return !NON_CHAT_RE.test(modelId)
}

/**
 * 모델 용도 한 줄 안내(친절어) — 사용자가 "이게 뭐 할 때 쓰는지" 바로 알게. 이름·능력 기반 추론.
 */
export function inferModelUseCase(provider: AiChatProviderId, modelId: string, caps: ModelCapabilities): string {
  // 세그먼트(-/_/. 구분) 단위 매칭 — "gemini"가 "mini"를 부분포함하는 오탐 방지.
  const parts = modelId.toLowerCase().split(/[-_.]/)
  const has = (...ws: string[]) => ws.some((w) => parts.includes(w))
  if (caps.reasoning && has('pro', 'opus', 'o1', 'o3', 'o4', 'thinking')) {
    return '복잡한 추론·분석·코딩 등 어려운 작업에 강함 (정확하지만 느린 편)'
  }
  if (has('lite', 'mini', 'nano', 'haiku')) {
    return '가장 빠르고 저렴 — 간단한 질문·분류·대량 처리에 적합'
  }
  if (has('flash', 'turbo')) {
    return '빠른 범용 — 일상 대화·요약·초안 작성에 적합'
  }
  if (has('pro', 'opus', '4o', 'sonnet')) {
    return '고품질 범용 — 긴 문서 분석·정밀한 답변에 적합'
  }
  return '범용 대화 모델'
}

function prettifyLabel(modelId: string): string {
  return modelId
    .replace(/^models\//, '')
    .split(/[-_]/)
    .map((t) => (/^\d/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(' ')
}

/**
 * 공급자별 모델 이름 규칙.
 *
 * 키를 명세(AiProviderId)에서 받으므로 여섯째 공급자를 명세에 더하면 여기에 자리를 만들기 전까지
 * 타입이 통과하지 않는다 — 새 공급자의 모델이 남의 공급자 규칙으로 읽히던 것을 막는다
 * (예전에는 gemini 도 claude 도 아니면 전부 openai 규칙으로 떨어져, Groq 모델이 128,000 토큰이라는
 *  근거 없는 숫자를 달고 나왔다).
 *
 * 이름이 아무 말도 하지 않으면 채우지 않는다. 확실치 않은 숫자를 화면에 띄우느니 비워 둔다.
 */
interface ModelNameHeuristic {
  vision(id: string): boolean
  longContext(id: string): boolean
  reasoning(id: string): boolean
  contextLength(id: string): number | undefined
  releasedAt(id: string): string | undefined
}

const UNKNOWN_DATE = (): undefined => undefined
const UNKNOWN_LENGTH = (): undefined => undefined

const MODEL_HEURISTICS: Record<AiChatProviderId, ModelNameHeuristic> = {
  gemini: {
    // 현대 Gemini 는 전부 멀티모달 + 대용량 컨텍스트
    vision: () => true,
    longContext: () => true,
    reasoning: (id) => /pro|thinking|2\.5|exp/.test(id),
    contextLength: (id) => (/pro/.test(id) ? 2097152 : 1048576),
    releasedAt: (id) =>
      /2\.5/.test(id) ? '2025-03-25' : /2\.0/.test(id) ? '2025-02-05' : /1\.5/.test(id) ? '2024-05-14' : undefined,
  },
  claude: {
    vision: () => true,
    longContext: () => false,
    reasoning: (id) => /opus|sonnet-4|3-7|thinking/.test(id),
    contextLength: () => 200000,
    releasedAt: (id) => (/opus-4|sonnet-4-6/.test(id) ? '2026-01-01' : /sonnet-4/.test(id) ? '2025-05-14' : undefined),
  },
  openai: {
    vision: (id) => /^gpt-5/.test(id) || /4o|4\.1|o1|o3|o4|4-turbo/.test(id),
    longContext: () => false,
    reasoning: (id) => /^o[134]/.test(id) || /^gpt-5/.test(id),
    // gpt-5 계열의 컨텍스트 길이는 세부 모델마다 달라 추론하지 않는다 — 과거 gpt-5.x 가 전부
    // 128,000 토큰으로 잘못 표기되던 문제.
    contextLength: (id) => (/^gpt-5/.test(id) ? undefined : /^o[134]/.test(id) ? 200000 : 128000),
    releasedAt: UNKNOWN_DATE,
  },
  groq: {
    // 남의 오픈소스 모델을 얹어 돌린다. 모델 이름이 곧 원 모델 이름이라 그것으로 읽는다.
    // 이미지 읽기는 명세가 이미 못 한다고 적었으므로(어댑터가 이미지를 보내지 않는다) 늘 false 다.
    vision: () => false,
    longContext: (id) => /versatile|scout|maverick|128k|131072/.test(id),
    reasoning: (id) => /r1|qwq|reasoning|thinking/.test(id),
    // 같은 이름의 모델도 Groq 이 얹은 컨텍스트가 8k 와 131k 로 갈린다. 큐레이션에 없으면 비운다
    contextLength: UNKNOWN_LENGTH,
    releasedAt: UNKNOWN_DATE,
  },
  grok: {
    // x.ai 는 mini 갈래만 이미지를 못 읽는다
    vision: (id) => /vision/.test(id) || (/^grok-[3-9]/.test(id) && !/mini/.test(id)),
    longContext: (id) => /^grok-[3-9]/.test(id),
    reasoning: (id) => /^grok-[3-9]/.test(id),
    contextLength: UNKNOWN_LENGTH,
    releasedAt: UNKNOWN_DATE,
  },  jev: {
    /**
     * 관문 뒤가 어느 벤더인지는 모델 이름의 앞머리(`openai/…`·`anthropic/…`)가 말한다.
     * 이름으로 못 읽는 것은 **비워 둔다** — 짐작으로 채우면 화면이 거짓을 말한다.
     */
    vision: (id) => /gpt-4o|gpt-5|claude|gemini|sonnet|opus|vision/.test(id),
    longContext: (id) => /gemini|claude|sonnet|opus/.test(id),
    reasoning: (id) => /o[134]|gpt-5|thinking|reasoning|opus|r1/.test(id),
    contextLength: UNKNOWN_LENGTH,
    releasedAt: UNKNOWN_DATE,
  },

}

/**
 * 모델 ID 휴리스틱 추론 — 큐레이션 맵에 없는 라이브 모델도 능력(멀티모달=vision)·라벨·출시일·컨텍스트를
 * 이름 패턴으로 유추해 "빈칸"을 없앤다. 큐레이션이 있으면 그게 우선(정확), 없으면 이 추론이 채운다.
 *
 * 이미지 읽기만은 이름보다 명세가 위다 — 어댑터가 이미지를 보내지 않는 공급자의 모델에
 * 「이미지 읽기」를 적으면 카드가 거짓말을 한다.
 */
export function inferModelMeta(
  provider: AiChatProviderId,
  modelId: string,
  /** 공급자가 이 모델에 대해 스스로 말해 준 것. 있으면 짐작보다 위다 */
  facts?: ListedModelFacts | null,
): CuratedModelInfo {
  const id = modelId.toLowerCase()
  const h = MODEL_HEURISTICS[provider]
  const canSeeImages = getProviderSpec(provider).capabilities.vision

  // 공급자가 무엇을 먹는지 말해 줬으면 그 답을 쓴다. 이름을 보고 점치지 않는다
  const saysImage = facts?.inputModalities?.includes('image')
  const vision = saysImage ?? (h.vision(id) && canSeeImages)

  // 컨텍스트 길이도 마찬가지다. I04 에서 근거가 없어 비웠는데, 근거를 주는 공급자가 있었다
  const contextLength = facts?.contextWindow ?? h.contextLength(id)

  return {
    label: prettifyLabel(modelId),
    contextLength,
    capabilities: {
      // 공급자가 못 보낸다고 적힌 곳에서는 모델이 무엇이든 이미지를 읽는다고 적지 않는다
      vision: vision && canSeeImages,
      // 공급자가 길이를 말해 줬을 때만 숫자로 판단한다. 이름 추론으로 짐작한 길이로
      // 뜻을 바꾸면 「긴 컨텍스트」의 기준이 공급자마다 조용히 달라진다
      longContext: facts?.contextWindow !== undefined
        ? facts.contextWindow >= LONG_CONTEXT_TOKENS
        : h.longContext(id),
      reasoning: h.reasoning(id),
    },
    releasedAt: h.releasedAt(id),
  }
}
