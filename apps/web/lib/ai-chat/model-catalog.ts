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
  return {
    provider,
    modelId,
    label: existing?.label ?? curated?.label ?? modelId,
    contextLength: existing?.contextLength ?? curated?.contextLength ?? null,
    capabilities: {
      ...DEFAULT_CAPS,
      ...curated?.capabilities,
      ...(existing?.capabilities ?? {}),
    },
    releasedAt: existing?.releasedAt ?? curated?.releasedAt ?? null,
    isActive: true,
  }
}
