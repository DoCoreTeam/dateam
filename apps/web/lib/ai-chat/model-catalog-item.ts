// 표 한 줄을 화면 한 줄로 — 모델 고르기가 읽는 줄의 SSOT
//
// 예전엔 이 변환이 `app/(ai)/ai/actions.ts` 안에 있었다. 그래서 같은 표를 읽는 다른 화면이
// 그 줄을 만들려면 **관리자 관문을 지나거나 변환을 다시 적어야** 했다.
// 관문은 화면마다 다르고(관리자·트레이딩 소유자) 변환은 같아야 한다 — 그 둘을 여기서 가른다.
//
// 이 파일에는 관문도 질의도 없다. 받은 줄을 바꾸기만 한다.

import { inferModelMeta, inferModelUseCase, isChatModel, type ModelCapabilities } from './model-catalog.ts'
import type { AiChatProviderId } from '@/types/database'

/** 화면이 그리는 한 줄 */
export interface ModelCatalogItem {
  provider: AiChatProviderId
  modelId: string
  label: string
  contextLength: number | null
  capabilities: ModelCapabilities
  releasedAt: string | null
  /** 무엇에 쓰는지 한 줄 */
  useCase: string
  availability: 'available' | 'limited' | 'unavailable' | 'unknown'
  availabilityReason: string | null
  availabilityCheckedAt: string | null
}

/** 표에서 읽은 한 줄. 옛 스키마에는 availability 세 칸이 없어 전부 선택이다 */
export interface ModelCatalogRow {
  provider: AiChatProviderId
  model_id: string
  label: string | null
  context_length?: number | null
  capabilities?: Partial<ModelCapabilities> | null
  released_at?: string | null
  is_active: boolean
  availability?: ModelCatalogItem['availability'] | null
  availability_reason?: string | null
  availability_checked_at?: string | null
}

/** 더 이상 공급자 목록에 없는 모델에 붙는 말 */
export const MODEL_GONE_REASON = '더 이상 공급자 모델 목록에 없는 모델입니다.'

/**
 * 한 줄을 화면 줄로 바꾼다.
 *
 * 저장된 능력 칸이 비어 있으면 이름에서 **추론해서 채운다** — 안 그러면 예전에 들어온 행이
 * 능력도 출시일도 빈 채로 뜬다.
 */
export function toModelCatalogItem(row: ModelCatalogRow): ModelCatalogItem {
  const inferred = inferModelMeta(row.provider, row.model_id)
  const dbCaps = row.capabilities ?? {}
  const capsEmpty = !dbCaps.vision && !dbCaps.longContext && !dbCaps.reasoning
  const capabilities = capsEmpty
    ? inferred.capabilities
    : { vision: false, longContext: false, reasoning: false, ...dbCaps }
  return {
    provider: row.provider,
    modelId: row.model_id,
    label: row.label ?? inferred.label,
    contextLength: row.context_length ?? inferred.contextLength ?? null,
    capabilities,
    releasedAt: row.released_at ?? inferred.releasedAt ?? null,
    useCase: inferModelUseCase(row.provider, row.model_id, capabilities),
    availability: row.is_active ? (row.availability ?? 'unknown') : 'unavailable',
    availabilityReason: row.is_active ? (row.availability_reason ?? null) : MODEL_GONE_REASON,
    availabilityCheckedAt: row.availability_checked_at ?? null,
  }
}

/**
 * 살아 있는 채팅 모델만 골라 화면 줄로 바꾼다.
 *
 * **여기서 가용성으로 거르지 않는다.** 걸러 버리면 「막힌 모델이 몇 개 있다」는 사실 자체가
 * 사라져 화면이 「카탈로그에 모델이 없습니다」로 거짓말한다 — 그 판정은 모달이 한다.
 */
export function toModelCatalogItems(rows: readonly ModelCatalogRow[]): ModelCatalogItem[] {
  return rows
    .filter((r) => r.is_active && isChatModel(r.provider, r.model_id))
    .map(toModelCatalogItem)
}
