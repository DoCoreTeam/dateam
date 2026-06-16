'use client'
import { useMemo } from 'react'
import { SWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { createPersistentProvider } from '@/lib/swr-persist'

export default function SWRProvider({ children }: { children: React.ReactNode }) {
  // provider는 마운트당 1회만 생성(재생성 시 캐시 초기화됨). 기존 동작(fetch·dedup·keepPreviousData)은 그대로.
  const provider = useMemo(() => createPersistentProvider(), [])
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: false, dedupingInterval: 5000, provider }}>
      {children}
    </SWRConfig>
  )
}
