// lib/ai/key-rotation.ts — 「막힌 키를 건너뛰고 다음 키로」 한 벌
//
// 왜 여기 따로 두나
//   같은 일이 세 자리에 필요하다 — 공통 Gemini 호출기, 회의 녹음 전사, 임베딩.
//   셋이 각자 「무엇을 키 문제로 보고 언제 넘어갈지」를 정하면, 같은 429 가
//   어떤 길에서는 키 교체가 되고 어떤 길에서는 그냥 실패가 된다.
//   그 어긋남은 화면에서 전부 「AI 가 안 된다」로 보여서 원인을 못 찾는다.
//
// 여기서 정하지 않는 것
//   무엇이 키 문제인가는 `lib/ai-chat/provider-errors.ts` 가, 어느 키를 먼저 쓰는가는
//   `lib/ai/key-pool.ts` 가, 표를 어떻게 읽는가는 `lib/ai/key-store.ts` 가 정한다.
//   이 파일은 그 셋을 이어 붙이고 **호출을 몇 번 더 할지**만 정한다.

import { classifyProviderError } from '../ai-chat/provider-errors.ts'
import { orderKeys, type KeyPoolEntry, type KeyOutcome } from './key-pool.ts'
import { metaEntry } from './key-store-core.ts'
import type { AiProviderId } from './provider-catalog.ts'

/** 키 목록과 결말 기록. 안 주면 표에서 읽는다 */
export interface KeyRotationDeps {
  entries?: KeyPoolEntry[]
  record?: (entry: KeyPoolEntry, outcome: KeyOutcome, errorMessage?: string) => Promise<void> | void
}

/** 이 실패에 키를 바꿀 것인가. 바꿀 것이면 그 키를 어떻게 적을지까지 */
export function keyOutcomeOf(err: unknown): KeyOutcome {
  return classifyProviderError(err).keyOutcome ?? 'transient'
}

/**
 * 부르는 쪽이 준 키를 맨 앞에 두고 표의 나머지를 잇는다.
 * 같은 키가 표에도 있으면 표의 줄을 쓴다 — 그래야 결말이 그 줄에 적힌다.
 */
function mergeKeys(provider: AiProviderId, apiKey: string, rows: readonly KeyPoolEntry[]): KeyPoolEntry[] {
  const mine = rows.find((r) => r.apiKey === apiKey)
  return [mine ?? metaEntry(provider, apiKey), ...rows.filter((r) => r.apiKey !== apiKey)]
}

/**
 * 쓸 키 목록. 주입이 없으면 표에서 읽되 **못 읽어도 던지지 않는다** —
 * 키 저장소가 없다는 이유로 기능이 멈추면 고친 것보다 망가뜨린 것이 크다.
 * (시험 환경에서는 `key-store` 가 server-only 라 애초에 안 불리고 이 catch 로 온다)
 */
async function resolveDeps(
  provider: AiProviderId,
  apiKey: string,
  given: KeyRotationDeps | undefined,
): Promise<Required<Pick<KeyRotationDeps, 'entries'>> & KeyRotationDeps> {
  if (given?.entries) {
    return { entries: mergeKeys(provider, apiKey, given.entries), record: given.record }
  }
  try {
    const store = await import('./key-store.ts')
    const rows = await store.readKeyPool(provider)
    return {
      entries: mergeKeys(provider, apiKey, orderKeys(rows, Date.now())),
      record: given?.record ?? store.recordKeyOutcome,
    }
  } catch {
    return { entries: [metaEntry(provider, apiKey)], record: given?.record }
  }
}

/**
 * 키를 바꿔 가며 `run` 을 부른다.
 *
 * - 한도(429)와 인증(401·403)은 **그 키의 문제**다 → 다음 키로 같은 일을 다시 한다
 * - 그 밖의 실패는 키를 바꿔도 같다 → 그대로 올린다. 네트워크가 한 번 튄 것으로
 *   키를 하나씩 소진하면, 정작 한도가 찼을 때 쓸 키가 남아 있지 않다
 * - 키를 다 써도 안 되면 **마지막 오류를 그대로** 올린다. 원인을 우리 말로 바꾸지 않는다
 *
 * 키가 하나면 `run` 은 정확히 한 번 불린다 — 교체가 헛호출을 늘리지 않는다.
 */
export async function withProviderKeys<T>(
  provider: AiProviderId,
  apiKey: string,
  run: (apiKey: string, entry: KeyPoolEntry) => Promise<T>,
  deps?: KeyRotationDeps,
): Promise<T> {
  const { entries, record } = await resolveDeps(provider, apiKey, deps)
  const note = async (entry: KeyPoolEntry, outcome: KeyOutcome, detail?: string): Promise<void> => {
    // 기록이 호출을 막지 않는다 — 다음 호출을 낫게 하는 장치이지 이번 호출의 조건이 아니다
    try { await record?.(entry, outcome, detail) } catch { /* 삼킨다 */ }
  }

  let lastError: unknown = null
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    try {
      const value = await run(entry.apiKey, entry)
      await note(entry, 'ok')
      return value
    } catch (e) {
      lastError = e
      const outcome = keyOutcomeOf(e)
      await note(entry, outcome, e instanceof Error ? e.message : String(e ?? ''))
      // 키를 바꿔도 같은 답이 올 실패다. 남은 키를 태우지 않고 그대로 올린다
      if (outcome === 'transient') throw e
    }
  }
  throw lastError ?? new Error(`${provider} 키가 하나도 없습니다`)
}
