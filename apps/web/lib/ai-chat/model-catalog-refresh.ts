// lib/ai-chat/model-catalog-refresh.ts — 공급자에게 모델 목록을 받아 카탈로그를 채운다
//
// ## 왜 관문 밖으로 뺐나 (실측 2026-09-28)
//
// 이 일은 `app/(ai)/ai/actions.ts` 안에 있었고 그 창구는 **관리자 전용**이다.
// 그래서 AI 트레이딩 소유자는 자기 판단 모델 목록을 받아 올 길이 없었고,
// `ai_model_catalog` 에 jev 모델이 **0개**인 채로 남았다 — 화면은 「다른 모델을 고르세요」라고
// 말하는데 고를 것이 하나도 없었다. 사용자가 「어떻게 저장해야 하는거야」라고 물은 자리다.
//
// 일은 여기 한 곳에 두고 **관문은 부르는 쪽이 각자 들고 있는다.**
// 관리자 화면은 관리자 확인을, 트레이딩 화면은 소유자 확인을 자기 첫 줄에서 한다.
// 이 모듈은 아무 확인도 하지 않으므로 **서버 액션에서만 부른다** — 그래서 `server-only` 다.

import 'server-only'

import { getProvider } from './registry'
import { resolveProviderKey, messageFor } from '../ai/provider-key-source'
import { mergeModelCatalogEntry, isChatModel, type ModelCapabilities } from './model-catalog'
import { probeModelIdsAcrossKeys } from './probe-models'
import type { ListedModelFacts } from './provider'
import { isAvailabilitySchemaMissing } from './model-availability'
import type { AiProviderId } from '../ai/provider-catalog'
import type { AiChatProviderId } from '@/types/database'

/** 서비스롤 클라이언트. 부르는 쪽이 이미 사람 확인을 마치고 넘긴다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = any

type ModelCatalogItemAvailability = 'available' | 'limited' | 'unavailable' | 'unknown'

export interface ModelAvailabilitySnapshot {
  modelId: string
  availability: ModelCatalogItemAvailability
  availabilityReason: string | null
  availabilityCheckedAt: string | null
}

export interface RefreshOptions {
  /** 기존 추론값을 버리고 다시 도출한다 */
  force?: boolean
  /**
   * 모델마다 실제로 한 번 불러 쓸 수 있는지 확인할까.
   * 기본은 확인한다(관리자 화면의 지금 동작). 고르기용으로 목록만 받을 때는 끈다
   */
  probe?: boolean
}

export interface RefreshResult {
  ok: boolean
  count?: number
  availability?: ModelAvailabilitySnapshot[]
  error?: string
}

/** 최근에 확인한 모델은 다시 안 찌른다 */
const AVAILABILITY_TTL_MS = 6 * 60 * 60 * 1000

export async function refreshCatalogFor(
  admin: AdminClient,
  provider: AiProviderId,
  options?: RefreshOptions,
): Promise<RefreshResult> {
  const force = options?.force === true
  /**
   * **찔러 볼지는 부르는 쪽이 정한다.**
   *
   * 관문(Jev)은 뒤에 391개가 있다(실측 2026-09-28). 그 전부에 실제 호출을 날리면
   * 목록 한 번 받는 데 391번을 부르고 돈과 시간을 태운다. 목록만 있으면 고를 수 있으므로
   * 고르기용으로 받을 때는 상태를 「모름」으로 둔다 — 지어내지 않고 모른다고 적는다.
   */
  const wantProbe = options?.probe !== false

  /**
   * **키는 고르는 자리 하나에서 받는다** (`lib/ai/provider-key-source`).
   *
   * 여기서 META 를 직접 읽으면 그 길은 판(운영·개발)을 안 본다 —
   * 그러면 개발 판이 운영 키로 벤더를 두드리고, 더 나쁘게는 **목록은 받아지는데
   * 판단은 안 도는** 상태가 된다(판단기는 같은 자리에서 키를 받으므로).
   * 둘이 같은 답을 봐야 화면이 한 가지 말을 한다.
   */
  const choice = await resolveProviderKey(provider)
  if (!choice.apiKey) {
    return { ok: false, error: messageFor(choice) ?? '해당 공급자의 AI 키가 설정되지 않았습니다' }
  }
  const config = { apiKey: choice.apiKey }

  // 공급자가 모델마다 사실을 더 주면 그것을 받는다. 안 주는 공급자는 id 만 받고 추론으로 채운다
  const adapter = getProvider(provider as AiChatProviderId)
  let modelIds: string[]
  let factsById = new Map<string, ListedModelFacts>()
  try {
    if (adapter.describeModels) {
      const described = await adapter.describeModels(config.apiKey)
      factsById = new Map(described.map((f) => [f.id, f]))
      modelIds = described.map((f) => f.id)
    } else {
      modelIds = await adapter.listModels(config.apiKey)
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '모델 목록 조회에 실패했습니다' }
  }
  // 비채팅 모델(임베딩·TTS·이미지 등) 제외 — 모델 선택에 무관.
  modelIds = modelIds.filter((id) => isChatModel(provider, id))
  if (modelIds.length === 0) return { ok: true, count: 0 }

  const EXISTING_COLUMNS = 'model_id, label, context_length, capabilities, released_at'
  let { data: existingData, error: existingError } = await admin
    .from('ai_model_catalog')
    .select(`${EXISTING_COLUMNS}, availability, availability_reason, availability_checked_at`)
    .eq('provider', provider)
    .in('model_id', modelIds)
  if (isAvailabilitySchemaMissing(existingError)) {
    const legacy = await admin.from('ai_model_catalog')
      .select(EXISTING_COLUMNS)
      .eq('provider', provider)
      .in('model_id', modelIds)
    existingData = legacy.data
    existingError = legacy.error
  }
  const existingRows = (existingData ?? []) as Array<{
    model_id: string
    label: string | null
    context_length: number | null
    capabilities: Partial<ModelCapabilities> | null
    released_at: string | null
    availability?: ModelCatalogItemAvailability | null
    availability_reason?: string | null
    availability_checked_at?: string | null
  }>
  const existingMap = new Map(existingRows.map((r) => [r.model_id, r]))

  const checkedAt = new Date().toISOString()
  const nowMs = Date.parse(checkedAt)
  // 최근에 확인한 모델은 다시 찌르지 않는다(force면 전량 재확인).
  const isFresh = (modelId: string): boolean => {
    if (force) return false
    const row = existingMap.get(modelId)
    if (!row?.availability || !row.availability_checked_at) return false
    const checked = Date.parse(row.availability_checked_at)
    return Number.isFinite(checked) && nowMs - checked < AVAILABILITY_TTL_MS
  }
  const staleModelIds = modelIds.filter((id) => !isFresh(id))

  // listModels는 generateContent 지원 여부만 알려줄 뿐, 현재 키/요금제로 실제 전송 가능한지는
  // 보장하지 않는다(예: 요금제 할당량 0·신규 불가 모델). 실사용 프로브로 진짜 못 쓰는 모델만 걸러낸다.
  /*
    **등록된 키 전부로 묻는다.** 키 하나로 훑으면 그 키의 사정이 모델의 사정으로 적히고,
    그 값을 `buildModelChain` 이 읽어 멀쩡한 모델을 후보에서 뺀다 (실측 2026-09-23:
    무료 키 하나로 훑은 결과가 한 달간 굳어 젬민 32개 중 4개만 쓸 수 있었다).
  */
  const probeMap = wantProbe
    ? await probeModelIdsAcrossKeys(provider, config.apiKey, getProvider(provider as AiChatProviderId), staleModelIds)
    : new Map<string, { usable: boolean; availability?: ModelCatalogItemAvailability; reason?: string | null }>()

  const upsertRows = modelIds.map((modelId) => {
    const existing = existingMap.get(modelId)
    // 평소엔 기존 DB값을 보존한다. 다만 "모델 새로고침"(force)은 기존값을 버리고 큐레이션+추론으로
    // 다시 도출한다 — 이 세 컬럼을 쓰는 곳이 여기뿐이라 사람이 넣은 값이 없고, 과거의 잘못된 추론이
    // 스스로 풀릴 길이 달리 없기 때문이다(gpt-5.x가 전부 128,000 tok·능력 false로 굳어 있던 문제).
    // 나중에 관리자 수정 UI가 생기면 여기에 출처(provenance) 구분을 먼저 넣어야 한다.
    const merged = mergeModelCatalogEntry(provider as AiChatProviderId, modelId, force ? null : {
      label: existing?.label,
      contextLength: existing?.context_length,
      capabilities: existing?.capabilities,
      releasedAt: existing?.released_at,
    }, factsById.get(modelId))
    const probed = probeMap.get(modelId)
    return {
      provider: merged.provider,
      model_id: merged.modelId,
      label: merged.label,
      context_length: merged.contextLength,
      capabilities: merged.capabilities,
      released_at: merged.releasedAt,
      is_active: true,
      availability: probed ? probed.availability ?? 'unknown' : existing?.availability ?? 'unknown',
      availability_reason: probed ? probed.reason ?? null : existing?.availability_reason ?? null,
      availability_checked_at: probed ? checkedAt : existing?.availability_checked_at ?? checkedAt,
      fetched_at: checkedAt,
    }
  })

  let { error: upsertError } = await admin
    .from('ai_model_catalog')
    .upsert(upsertRows, { onConflict: 'provider,model_id' })
  if (isAvailabilitySchemaMissing(upsertError)) {
    const legacyRows = upsertRows.map(({ availability: _availability, availability_reason: _reason, availability_checked_at: _availabilityCheckedAt, ...row }) => row)
    const legacy = await admin.from('ai_model_catalog')
      .upsert(legacyRows, { onConflict: 'provider,model_id' })
    upsertError = legacy.error
  }
  if (upsertError) return { ok: false, error: '모델 카탈로그 저장 중 오류가 발생했습니다' }

  // 더 이상 응답에 없는 기존 모델은 비활성화(목록에서 숨김, 행은 보존)
  const { error: deactivateError } = await admin
    .from('ai_model_catalog')
    .update({ is_active: false })
    .eq('provider', provider)
    .not('model_id', 'in', `(${modelIds.join(',')})`)
  if (deactivateError) {
    // 비활성화 실패는 치명적이지 않음(다음 새로고침에서 재시도) — upsert는 이미 성공했으므로 ok 유지
  }

  return {
    ok: true,
    count: upsertRows.length,
    availability: upsertRows.map((row) => ({
      modelId: row.model_id,
      availability: row.availability,
      availabilityReason: row.availability_reason,
      availabilityCheckedAt: row.availability_checked_at,
    })),
  }
}
