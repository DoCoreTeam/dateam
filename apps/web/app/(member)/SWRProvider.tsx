'use client'
import { useMemo } from 'react'
import { SWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { createPersistentProvider } from '@/lib/swr-persist'
import SyncRevalidator from './SyncRevalidator'

export default function SWRProvider({ children }: { children: React.ReactNode }) {
  // provider는 마운트당 1회만 생성(재생성 시 캐시 초기화됨). 기존 동작(fetch·dedup·keepPreviousData)은 그대로.
  const provider = useMemo(() => createPersistentProvider(), [])
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,
        // 영속 캐시(디스크)가 있으면 마운트 시 자동 네트워크 재검증 안 함(즉시 표시).
        // 단 데이터가 없으면(첫 방문) SWR이 정상 fetch — revalidateIfStale은 캐시 데이터가 있을 때만 영향.
        // 변경 감지는 SyncRevalidator가 sync/version 토큰 비교로 명시 재검증(변경된 리소스만).
        // revalidateOnReconnect는 기본(true) 유지 — 네트워크 복구 시 안전망.
        revalidateIfStale: false,
        dedupingInterval: 5000,
        provider,
      }}
    >
      <SyncRevalidator />
      {children}
    </SWRConfig>
  )
}
