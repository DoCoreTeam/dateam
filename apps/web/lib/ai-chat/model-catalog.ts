// 모델 카탈로그(⑤) — 큐레이션 기본 능력/출시일 맵 + 병합 헬퍼(순수 함수, 단위테스트 대상).
// DB(ai_model_catalog, 마이그 156)의 시드값과 동일 데이터를 코드에도 유지 — refreshModelCatalog가
// 실 프로바이더 응답(listModels)으로 model_id를 upsert할 때 capabilities/released_at 보완에 사용.
import type { AiChatProviderId } from '@/types/database'

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
): ModelCatalogEntry {
  const curated = CURATED_MODELS[provider]?.[modelId]
  const inferred = inferModelMeta(provider, modelId) // 큐레이션에 없는 라이브 모델 보완(빈칸 방지)
  return {
    provider,
    modelId,
    label: existing?.label ?? curated?.label ?? inferred.label,
    contextLength: existing?.contextLength ?? curated?.contextLength ?? inferred.contextLength ?? null,
    capabilities: {
      ...DEFAULT_CAPS,
      ...inferred.capabilities,       // 추론이 최하위
      ...curated?.capabilities,       // 큐레이션이 우선
      ...(existing?.capabilities ?? {}), // 기존 DB값이 최우선
    },
    releasedAt: existing?.releasedAt ?? curated?.releasedAt ?? inferred.releasedAt ?? null,
    isActive: true,
  }
}

// 비채팅 모델(임베딩·TTS·이미지생성 등)은 모델 선택에서 제외. `-image`/`banana`=이미지 생성 모델.
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
 * 모델 ID 휴리스틱 추론 — 큐레이션 맵에 없는 라이브 모델도 능력(멀티모달=vision)·라벨·출시일·컨텍스트를
 * 이름 패턴으로 유추해 "빈칸"을 없앤다. 큐레이션이 있으면 그게 우선(정확), 없으면 이 추론이 채운다.
 */
export function inferModelMeta(provider: AiChatProviderId, modelId: string): CuratedModelInfo {
  const id = modelId.toLowerCase()
  let capabilities: ModelCapabilities = { ...DEFAULT_CAPS }
  let releasedAt: string | undefined
  let contextLength: number | undefined

  if (provider === 'gemini') {
    // 현대 Gemini는 전부 멀티모달(vision)+대용량 컨텍스트. pro/thinking/2.5/exp는 추론형.
    capabilities = { vision: true, longContext: true, reasoning: /pro|thinking|2\.5|exp/.test(id) }
    contextLength = /pro/.test(id) ? 2097152 : 1048576
    releasedAt = /2\.5/.test(id) ? '2025-03-25' : /2\.0/.test(id) ? '2025-02-05' : /1\.5/.test(id) ? '2024-05-14' : undefined
  } else if (provider === 'claude') {
    capabilities = { vision: true, longContext: false, reasoning: /opus|sonnet-4|3-7|thinking/.test(id) }
    contextLength = 200000
    releasedAt = /opus-4|sonnet-4-6/.test(id) ? '2026-01-01' : /sonnet-4/.test(id) ? '2025-05-14' : undefined
  } else {
    // openai: o1/o3/o4 계열은 추론형, 4o/4.1은 멀티모달.
    const reasoning = /^o[134]/.test(id)
    capabilities = { vision: /4o|4\.1|o1|o3|o4|4-turbo/.test(id), longContext: false, reasoning }
    contextLength = reasoning ? 200000 : 128000
  }
  return { label: prettifyLabel(modelId), contextLength, capabilities, releasedAt }
}
