'use client'
import { SWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'

export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: false, dedupingInterval: 5000 }}>
      {children}
    </SWRConfig>
  )
}
