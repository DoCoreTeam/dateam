'use client'

// SWR localStorage 백업 캐시 프로바이더 (SSOT)
// 목적: 재방문 시 마지막 데이터로 즉시 렌더 → SWR이 백그라운드 재검증.
// 보안: 캐시는 plain 직렬화이므로 userId 스코프 + 로그아웃 클리어로 공유 PC 잔류를 차단한다.
//  - 키 prefix: `swr-cache:<userId>` — 계정 전환/로그아웃 시 다른 키라 자동 격리.
//  - 마운트 시 저장된 userId ≠ 현재 세션 userId면 즉시 폐기.
//  - 로그아웃 시 clearPersistedSwrCache()로 명시 클리어.
// 안전: SSR 가드, try/catch(직렬화/파싱 실패 무시), 용량 가드, TTL(24h).
// 회귀: SWR Map 동작은 그대로 — provider 래핑만 추가, 실패 시 메모리 캐시 폴백.

import type { Cache, State } from 'swr'
import { createClient } from '@/lib/supabase/client'

const KEY_PREFIX = 'swr-cache:'
const TTL_MS = 24 * 60 * 60 * 1000 // 24h
const MAX_BYTES = 2 * 1024 * 1024 // 2MB 직렬화 용량 가드 (localStorage ~5MB 한도 여유)
const PERSIST_DEBOUNCE_MS = 1000

// 민감 SWR 키 prefix 블랙리스트(SSOT). 이 경로로 시작하는 SWR 키는
// localStorage 직렬화 payload에서 제외한다(메모리 캐시엔 남김 → 화면 동작 무영향).
// 화이트리스트가 아닌 블랙리스트로 명시: 새 민감 경로가 생기면 여기에만 추가.
const SENSITIVE_KEY_PREFIXES = [
  '/api/admin',
  '/api/auth',
  '/api-keys',
  '/change-password',
]

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PREFIXES.some((p) => key.startsWith(p))
}

// SWR State 객체(data/error/isLoading 등). 직렬화는 plain JSON으로 충분.
type CacheState = State<unknown, unknown>

interface PersistedPayload {
  userId: string
  savedAt: number
  data: Array<[string, CacheState]>
}

// SWR Cache 계약을 만족하는 Map (get/set/delete/keys).
type SwrCache = Map<string, CacheState> & Cache

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`
}

// swr-cache:* 키 전부 제거 (타 userId 잔류 포함). 로그아웃·불일치 시 사용.
function removeAllSwrCacheKeys(): void {
  if (!isBrowser()) return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(KEY_PREFIX)) toRemove.push(k)
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    /* 직렬화/접근 실패 무시 — 메모리 캐시만 사용 */
  }
}

// 로그아웃 시 호출(SSOT). 공유 PC 데이터 잔류 차단.
export function clearPersistedSwrCache(): void {
  removeAllSwrCacheKeys()
}

// 현재 uid의 키(storageKey(uid))를 제외한 모든 swr-cache:* 키 제거.
// 공유 PC에서 이전 사용자가 로그아웃 안 하고 닫아도, 다음 사용자 진입(uid 확정) 시
// 타 사용자 캐시를 폐기 → 단일 디바이스엔 현재 사용자 캐시 1벌만 유지(cross-user 잔류 차단).
function purgeOtherUserCacheKeys(uid: string): void {
  if (!isBrowser()) return
  try {
    const keep = storageKey(uid)
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(KEY_PREFIX) && k !== keep) toRemove.push(k)
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    /* 접근 실패 무시 — 메모리 캐시만 사용 */
  }
}

// 저장된 캐시를 현재 userId 기준으로 복원. 불일치/만료/손상 시 폐기 후 빈 Map.
function restoreCache(userId: string): SwrCache {
  const map = new Map<string, CacheState>() as SwrCache
  if (!isBrowser()) return map
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(storageKey(userId))
  } catch {
    return map
  }
  if (!raw) return map

  try {
    const parsed = JSON.parse(raw) as PersistedPayload
    // userId 불일치(=다른 계정) 또는 TTL 초과 → 즉시 폐기
    const expired = !parsed.savedAt || Date.now() - parsed.savedAt > TTL_MS
    if (parsed.userId !== userId || expired || !Array.isArray(parsed.data)) {
      removeAllSwrCacheKeys()
      return map
    }
    for (const [k, v] of parsed.data) {
      if (typeof k === 'string') map.set(k, v)
    }
  } catch {
    // JSON 파싱 실패(손상) → clear 후 메모리만
    removeAllSwrCacheKeys()
  }
  return map
}

// 직렬화 대상 항목 구성: 민감 키 제외 + error 필드 제거.
// - 민감 키(isSensitiveKey): 디스크 직렬화에서 빼 PII가 localStorage에 남지 않게 한다.
// - error 제거: Error 객체는 JSON에서 {}로 굳어 거짓 에러로 부활하므로 제거하고,
//   data/isValidating 등 정상 필드는 유지(복원 시 즉시 렌더 가능).
function buildPersistEntries(cache: SwrCache): Array<[string, CacheState]> {
  const entries: Array<[string, CacheState]> = []
  Array.from(cache.entries()).forEach(([k, v]) => {
    if (isSensitiveKey(k)) return
    const { error: _error, ...rest } = v as CacheState & { error?: unknown }
    entries.push([k, rest as CacheState])
  })
  return entries
}

function persistCache(userId: string, cache: SwrCache): void {
  if (!isBrowser()) return
  try {
    const payload: PersistedPayload = {
      userId,
      savedAt: Date.now(),
      data: buildPersistEntries(cache),
    }
    const serialized = JSON.stringify(payload)
    // 용량 가드: 초과 시 저장하지 않고 기존 캐시 폐기(부분 저장 방지)
    if (serialized.length > MAX_BYTES) {
      removeAllSwrCacheKeys()
      return
    }
    window.localStorage.setItem(storageKey(userId), serialized)
  } catch {
    // QuotaExceeded 등 직렬화/저장 실패 → 메모리만 사용, 잔류 캐시 폐기
    removeAllSwrCacheKeys()
  }
}

// SWR provider 팩토리. userId 확정 전에는 순수 메모리 Map(폴백)으로 동작.
// SWR provider 시그니처: (cache?: Readonly<Map<...>>) => Map<...>
export function createPersistentProvider(): () => SwrCache {
  return () => {
    if (!isBrowser()) return new Map<string, CacheState>() as SwrCache

    // userId 확정 전: 메모리 Map. 확정되면 비동기로 복원·영속 부착.
    const cache = new Map<string, CacheState>() as SwrCache
    let userId: string | null = null
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const schedulePersist = () => {
      if (!userId) return
      if (debounceTimer) clearTimeout(debounceTimer)
      const uid = userId
      debounceTimer = setTimeout(() => persistCache(uid, cache), PERSIST_DEBOUNCE_MS)
    }

    // set을 래핑해 변경 시 디바운스 영속 트리거 (SWR 내부는 set/delete만 사용)
    const originalSet = cache.set.bind(cache)
    cache.set = (k: string, v: CacheState) => {
      originalSet(k, v)
      schedulePersist()
      return cache
    }
    const originalDelete = cache.delete.bind(cache)
    cache.delete = (k: string) => {
      const r = originalDelete(k)
      schedulePersist()
      return r
    }

    // 세션 userId 해석 → 복원 후 현재 메모리에 머지(이미 in-flight한 fetch 보존)
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const uid = data.user?.id ?? null
        userId = uid
        if (!uid) {
          // 비인증 상태(로그아웃 직후 등) → 잔류 캐시 전체 폐기
          removeAllSwrCacheKeys()
          return
        }
        // 현재 사용자 외 모든 캐시 키 폐기(cross-user 잔류 차단) → 본인 캐시만 복원
        purgeOtherUserCacheKeys(uid)
        const restored = restoreCache(uid)
        restored.forEach((v, k) => {
          if (!cache.has(k)) originalSet(k, v)
        })
        // 복원 직후 1회 영속(머지 결과 반영)
        schedulePersist()
      })
      .catch(() => {
        /* 세션 해석 실패 → 메모리 캐시만 (영속 비활성) */
      })

    return cache
  }
}
