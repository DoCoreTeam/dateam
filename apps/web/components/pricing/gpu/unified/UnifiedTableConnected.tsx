'use client'

// 통합 표 데이터 연결 — cockpit SWR → 어댑터 → UnifiedTable.
// 데이터·계산은 기존 라우트/SSOT 재사용. 본 래퍼는 fetch+adapt만.

import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import UnifiedTable from './UnifiedTable'
import { cockpitToUnified } from '@/lib/gpu/cockpit-to-unified'
import { mergeInventory } from '@/lib/gpu/inventory-to-unified'
import type { CockpitApiResponse } from '@/lib/gpu/cockpit-to-unified'
import type { InventoryApiResponse } from '@/lib/gpu/inventory-to-unified'

interface UnifiedTableConnectedProps {
  onRegisterQuote?: () => void
  onManageMapping?: () => void
}

export default function UnifiedTableConnected({ onRegisterQuote, onManageMapping }: UnifiedTableConnectedProps) {
  const { data, error, isLoading } = useSWR<CockpitApiResponse>('/api/pricing/gpu/cockpit', fetcher, {
    refreshInterval: 60000,
  })
  // 재고 축 병합(재고 보기) — 보조 fetch. 실패해도 가격 보기는 정상.
  const { data: invData } = useSWR<InventoryApiResponse>('/api/pricing/gpu/inventory', fetcher, {
    refreshInterval: 120000,
  })
  const rows = mergeInventory(cockpitToUnified(data), invData)
  return (
    <UnifiedTable
      rows={rows}
      loading={isLoading}
      error={error ? '불러오기에 실패했습니다.' : null}
      usdKrw={data?.usd_krw ?? 1}
      onRegisterQuote={onRegisterQuote}
      onManageMapping={onManageMapping}
    />
  )
}
