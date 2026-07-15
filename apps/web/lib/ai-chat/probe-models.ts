// 모델 카탈로그 갱신 시 "실제로 못 쓰는 모델"을 걸러내기 위한 동시성 제한 프로브 유틸.
// listModels는 generateContent 지원 목록일 뿐, 현재 API키/요금제로 실제 전송 가능한지는 보장 안 함
// (예: gemini-pro-latest=free tier limit 0, 신규 불가 모델=404). refreshModelCatalog가 이를 사용해
// is_active를 결정한다. 신규 npm 의존성 없이 최소 구현.
import type { ChatProvider } from './provider.ts'

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
): Promise<Map<string, boolean>> {
  const usableMap = new Map<string, boolean>()
  if (!provider.probeModel || modelIds.length === 0) {
    for (const id of modelIds) usableMap.set(id, true)
    return usableMap
  }

  const probe = provider.probeModel
  await mapWithConcurrency(modelIds, concurrency, async (modelId) => {
    try {
      const result = await probe(apiKey, modelId)
      usableMap.set(modelId, result.usable)
    } catch {
      usableMap.set(modelId, true)
    }
  })
  return usableMap
}
