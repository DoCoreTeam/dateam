// 모델 카탈로그 갱신 시 "실제로 못 쓰는 모델"을 걸러내기 위한 동시성 제한 프로브 유틸.
// listModels는 generateContent 지원 목록일 뿐, 현재 API키/요금제로 실제 전송 가능한지는 보장 안 함
// (예: gemini-pro-latest=free tier limit 0, 신규 불가 모델=404). refreshModelCatalog가 이를 사용해
// is_active를 결정한다. 신규 npm 의존성 없이 최소 구현.
import type { ChatProvider, ProbeModelResult } from './provider.ts'

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
