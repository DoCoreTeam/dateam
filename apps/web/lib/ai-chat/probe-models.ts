// 모델 카탈로그 갱신 시 "실제로 못 쓰는 모델"을 걸러내기 위한 동시성 제한 프로브 유틸.
// listModels는 generateContent 지원 목록일 뿐, 현재 API키/요금제로 실제 전송 가능한지는 보장 안 함
// (예: gemini-pro-latest=free tier limit 0, 신규 불가 모델=404). refreshModelCatalog가 이를 사용해
// is_active를 결정한다. 신규 npm 의존성 없이 최소 구현.
import type { ChatProvider, ProbeModelResult } from './provider.ts'
import { resolveKeyEntries, type KeyRotationDeps } from '../ai/key-rotation.ts'
import type { AiProviderId } from '../ai/provider-catalog.ts'
import { orderKeysForProbe } from '../ai/key-pool.ts'
import type { KeyOutcome, KeyPoolEntry } from '../ai/key-pool.ts'

const DEFAULT_CONCURRENCY = 4

/** 동시성 제한 map — items를 최대 limit개씩 병렬로 fn 실행, 결과는 입력 순서 보존. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/**
 * modelIds 각각을 provider.probeModel로 실사용 가능 여부 확인.
 * provider가 probeModel을 구현하지 않으면 전부 usable:true(스킵, 기존 동작 유지).
 * 개별 프로브가 예외를 던지면 관대하게 usable:true로 간주(일시 장애로 모델을 벌하지 않음).
 */
export async function probeModelIds(
  provider: ChatProvider,
  apiKey: string,
  modelIds: string[],
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<Map<string, ProbeModelResult>> {
  const usableMap = new Map<string, ProbeModelResult>()
  if (!provider.probeModel || modelIds.length === 0) {
    for (const id of modelIds) usableMap.set(id, { usable: true, availability: 'unknown', reason: '가용 상태 확인을 지원하지 않는 공급자입니다.' })
    return usableMap
  }

  const probe = provider.probeModel
  // 계정(키) 단위 실패 — 크레딧 소진·키 무효는 모델을 바꿔도 결과가 같다. 한 번 감지되면 남은 모델은
  // 호출 없이 같은 결과로 채운다. 이게 없으면 모델 수만큼(예: OpenAI 86개) 실 API를 때려
  // 비용을 태우고 레이트리밋을 스스로 만들어낸다.
  // 주의: 이미 떠 있는 요청은 취소하지 않으므로 실제 호출 수는 1이 아니라 최대 concurrency다
  // (O(n) → O(concurrency)로 줄이는 것이 목적). 모델 단위 실패(404·일반 429)는 신호가 아니다.
  let accountFailure: ProbeModelResult | null = null

  await mapWithConcurrency(modelIds, concurrency, async (modelId) => {
    if (accountFailure) {
      usableMap.set(modelId, accountFailure)
      return
    }
    try {
      const result = await probe(apiKey, modelId)
      if (result.accountLevel) accountFailure = result
      usableMap.set(modelId, result)
    } catch {
      usableMap.set(modelId, { usable: true, availability: 'unknown', reason: '상태 확인 요청에 실패했습니다.' })
    }
  })
  return usableMap
}

/**
 * 어느 결과가 더 나은가. **되는 쪽이 이긴다.**
 *
 * 합치는 규칙을 굳이 함수로 빼는 이유: 「하나라도 되는 키가 있으면 available」이 이 항목의
 * 전부인데, 그 판정을 `>` 하나로 흩어 적으면 나중에 limited 나 unknown 이 available 을
 * 덮어쓰는 일이 조용히 생긴다.
 */
function rank(r: ProbeModelResult): number {
  const a = r.availability ?? (r.usable ? 'unknown' : 'unavailable')
  return a === 'available' ? 3 : a === 'limited' ? 2 : a === 'unknown' ? 1 : 0
}

/**
 * 등록된 키를 **전부** 돌며 훑고, 모델마다 가장 좋은 답을 남긴다.
 *
 * ## 왜 필요한가 (실측 2026-09-23)
 *
 * `ai_model_catalog` 의 `availability` 는 2026-08-27 에 **무료 키 하나로** 훑은 결과였다.
 * 그 키에는 `gemini-2.5-flash` 가 404 「no longer available to new users」였고
 * `gemini-pro-latest` 는 `limit: 0` 이었다. 둘 다 **그 키의 사정**인데 모델의 사정으로 적혔고,
 * `buildModelChain` 이 그걸 읽어 후보에서 뺐다. 그래서 유료 키를 등록한 뒤에도
 * 젬민 32개 중 4개만 쓸 수 있었고, 하필 그 하나가 503 이던 날 견적서 읽기가 통째로 죽었다.
 *
 * 그래서 「이 모델이 살아 있나」를 **이 일터의 키 전부**로 묻는다. 하나라도 되면 available 이다.
 * 되는 키가 하나도 없을 때만 unavailable 이고, 그때의 사유는 마지막으로 받은 사유다.
 *
 * ## 헛호출을 어떻게 줄이나
 *
 * 키마다 전량을 다시 찌르지 않는다. **아직 available 이 아닌 모델만** 다음 키로 넘긴다.
 * 유료 키가 맨 앞이라 보통 첫 바퀴에서 대부분 결판난다.
 *
 * ## 안 던진다
 *
 * 키가 전부 죽어도 마지막 표를 그대로 돌려준다. 예외를 올리면 훑기가 통째로 실패해
 * 카탈로그가 「결제를 확인하라」는 사실조차 못 적는다. 고친 것보다 망가뜨린 것이 커진다.
 */
export async function probeModelIdsAcrossKeys(
  providerId: AiProviderId,
  apiKey: string,
  provider: ChatProvider,
  modelIds: string[],
  concurrency: number = DEFAULT_CONCURRENCY,
  deps?: KeyRotationDeps,
): Promise<Map<string, ProbeModelResult>> {
  const best = new Map<string, ProbeModelResult>()
  if (modelIds.length === 0) return best

  const { entries, record } = await resolveKeyEntries(providerId, apiKey, deps)
  // 기록이 훑기를 막지 않는다 — 다음 호출을 낫게 하는 장치이지 이번 훑기의 조건이 아니다
  const note = async (entry: KeyPoolEntry, outcome: KeyOutcome, detail?: string): Promise<void> => {
    try { await record?.(entry, outcome, detail) } catch { /* 삼킨다 */ }
  }

  for (const entry of orderKeysForProbe(entries)) {
    const left = modelIds.filter((id) => rank(best.get(id) ?? { usable: false }) < 3)
    if (left.length === 0) break

    const map = await probeModelIds(provider, entry.apiKey, left, concurrency)
    for (const [id, r] of map) {
      const prev = best.get(id)
      if (!prev || rank(r) > rank(prev)) best.set(id, r)
    }

    /*
      계정 단위 실패는 **그 키가 죽은 것**이라 표에 적는다. 모델 단위 실패로는 안 적는다 —
      키를 바꿔도 같은 답이 오는 일로 멀쩡한 키를 재우면 정작 필요할 때 쓸 키가 없다.
    */
    const dead = [...map.values()].find((r) => r.accountLevel)
    if (dead) await note(entry, dead.keyOutcome ?? 'quota', dead.reason ?? undefined)
    else await note(entry, 'ok')
  }

  return best
}
