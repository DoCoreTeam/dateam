'use client'

// Phase B 조건부 재검증기 (SSOT).
// 목적: 영속 캐시가 stale일 수 있는 상황에서, "변경된 리소스만" 골라 SWR 재검증한다.
//   - revalidateIfStale:false 라서 마운트 시 자동 재검증이 꺼져 있다(즉시 표시, 네트워크 0).
//   - 이 컴포넌트가 sync/version 토큰을 직전값과 비교해, 토큰이 바뀐 리소스만 mutate(revalidate)한다.
//   - 안 바뀐 리소스는 아무 것도 안 함 → 캐시 그대로 = 네트워크 0.
//
// fail-safe(영구 stale 절대 금지): 확신 있을 때만 스킵, 불확실하면 재검증.
//   - sync/version 호출 실패 → 전체 재검증(mutate(()=>true)).
//   - 저장 토큰 없음(첫 방문/클리어) → 캐시가 비어 있으므로 자연 fetch에 맡기고 토큰만 저장(다음 비교 가능).
//   - 매핑 안 된 키 → 어떤 리소스 토큰에도 안 걸리므로 이 게이트가 손대지 않음. (단, 변경되면 자연 stale로 남지 않게
//     revalidateOnReconnect/수동 mutate 등 기존 SWR 경로로 갱신됨)

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useSWRConfig } from 'swr'
import { createClient } from '@/lib/supabase/client'
import { SWR_VER_KEY_PREFIX } from '@/lib/swr-persist'

const VERSION_URL = '/api/work/sync/version'

interface SyncVersionResponse {
  versions: Record<string, string>
  ts: string
}

// 리소스명 → 해당 SWR 키 매칭 함수.
// sync/version의 versions 키와 동일한 이름을 사용한다(BE가 리소스를 추가하면 여기에 매핑만 추가).
const RESOURCE_KEY_MATCHERS: Record<string, (key: string) => boolean> = {
  daily: (k) => k.startsWith('/api/daily'),
  calendar: (k) => k.startsWith('/api/calendar'),
  weekly: (k) => k.startsWith('/api/weekly'),
  projects: (k) =>
    k.startsWith('/api/projects') ||
    k.startsWith('/api/work/projects') ||
    k.startsWith('/api/work/groups'),
  accounts: (k) => k.startsWith('/api/accounts'),
  deals: (k) => k.startsWith('/api/deals'),
  contacts: (k) => k.startsWith('/api/contacts'),
}

function matchResource(resource: string, key: unknown): boolean {
  if (typeof key !== 'string') return false
  const matcher = RESOURCE_KEY_MATCHERS[resource]
  return matcher ? matcher(key) : false
}

function readStoredVersions(userId: string): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(`${SWR_VER_KEY_PREFIX}${userId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function storeVersions(userId: string, versions: Record<string, string>): void {
  try {
    window.localStorage.setItem(`${SWR_VER_KEY_PREFIX}${userId}`, JSON.stringify(versions))
  } catch {
    /* QuotaExceeded 등 무시 — 다음 라운드에서 전체 재검증으로 fail-safe */
  }
}

export default function SyncRevalidator() {
  const pathname = usePathname()
  const { mutate } = useSWRConfig()
  const userIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run(): Promise<void> {
      // userId 해석(1회 캐시) — 로그아웃 시 키 스코프 분리에 사용.
      if (!userIdRef.current) {
        const { data } = await createClient().auth.getUser()
        userIdRef.current = data.user?.id ?? null
      }
      const userId = userIdRef.current
      if (cancelled || !userId) return

      let res: Response
      try {
        res = await fetch(VERSION_URL, { cache: 'no-store' })
      } catch {
        // 네트워크 실패 → fail-safe 전체 재검증
        if (!cancelled) await mutate(() => true)
        return
      }
      if (cancelled) return
      if (!res.ok) {
        await mutate(() => true)
        return
      }

      const body = (await res.json()) as SyncVersionResponse
      const next = body?.versions
      if (cancelled || !next || typeof next !== 'object') {
        if (!cancelled) await mutate(() => true)
        return
      }

      const prev = readStoredVersions(userId)
      // 토큰을 항상 저장(다음 라운드 비교 가능 — 첫 방문도 이후엔 정확 비교됨).
      storeVersions(userId, next)

      // 저장 토큰 없음 = 첫 방문/클리어. 캐시가 비어 있어 자연 fetch에 맡긴다(전체 무효화 불필요).
      if (!prev) return

      // 토큰이 바뀐 리소스만 골라 매칭 키 재검증.
      const changed = Object.keys(next).filter((r) => next[r] !== prev[r])
      if (changed.length === 0) return // 변화 없음 → 네트워크 0

      await mutate((key) => changed.some((r) => matchResource(r, key)), undefined, {
        revalidate: true,
      })
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [pathname, mutate])

  return null
}
