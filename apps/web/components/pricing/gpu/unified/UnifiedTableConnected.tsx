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
  /** gcube 판매 마진(%) — 전역 설정값. 표 툴바의 마진 컨트롤에 표시. */
  marginPct?: number
  /** 관리자만 마진 편집 가능. */
  isAdmin?: boolean
  /** 마진 저장 후 settings SWR revalidate(상위 GpuPricingClient). */
  onMarginSaved?: () => void
  onRegisterQuote?: () => void
  onManageMapping?: () => void
}

export default function UnifiedTableConnected({ marginPct, isAdmin, onMarginSaved, onRegisterQuote, onManageMapping }: UnifiedTableConnectedProps) {
  // 가격 데이터 마운트 재검증(stale 방지)은 GpuPricingClient의 nested SWRConfig(revalidateIfStale:true)가 전 탭에 일괄 적용.
  const { data, error, isLoading, mutate } = useSWR<CockpitApiResponse>('/api/pricing/gpu/cockpit', fetcher, {
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
      marginPct={marginPct}
      isAdmin={isAdmin}
      // 마진 저장 → cockpit 재조회(자동가 재계산) + 상위 settings revalidate(표시값 갱신)
      onMarginSaved={() => { mutate(); onMarginSaved?.() }}
      onRegisterQuote={onRegisterQuote}
      onManageMapping={onManageMapping}
    />
  )
}
