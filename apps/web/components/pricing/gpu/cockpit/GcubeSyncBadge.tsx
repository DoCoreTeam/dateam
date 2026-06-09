'use client'

// components/pricing/gpu/cockpit/GcubeSyncBadge.tsx
// gcube 반영 상태 뱃지 — GcubeSiteCell 하단에 표시
// 색/라벨은 lib/tokens/status-colors.ts GCUBE_SYNC SSOT 참조

import type { GcubeSyncStatusKey } from '@/lib/tokens/status-colors'
import { GCUBE_SYNC } from '@/lib/tokens/status-colors'
import type { GcubeCheckItem } from '@/app/api/pricing/gpu/gcube-check/route'

interface GcubeSyncBadgeProps {
  item: GcubeCheckItem | undefined
  /** true면 툴팁 상세 표시 (checked_at, 비교 수치) */
  showDetail?: boolean
}

/** API status → GCUBE_SYNC key 변환 (null → 'unknown') */
function resolveKey(status: GcubeCheckItem['status']): GcubeSyncStatusKey {
  if (status === 'match') return 'match'
  if (status === 'mismatch') return 'mismatch'
  if (status === 'not_found') return 'not_found'
  if (status === 'our_unset') return 'our_unset'
  return 'unknown'
}

function fmtKRWShort(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`
  if (v >= 10_000) return `${(v / 10_000).toFixed(0)}만`
  return `${v.toLocaleString('ko-KR')}원`
}

export function GcubeSyncBadge({ item, showDetail = false }: GcubeSyncBadgeProps) {
  const key = resolveKey(item?.status ?? null)
  const meta = GCUBE_SYNC[key]

  const tooltipParts: string[] = []
  if (item?.checked_at) {
    const d = new Date(item.checked_at)
    tooltipParts.push(
      `확인: ${d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    )
  }
  if (item?.gcube_low_krw != null || item?.gcube_high_krw != null) {
    tooltipParts.push(
      `gcube: ${fmtKRWShort(item.gcube_low_krw)} ~ ${fmtKRWShort(item.gcube_high_krw)}`,
    )
  }
  if (item?.our_price_krw != null) {
    tooltipParts.push(`우리: ${fmtKRWShort(item.our_price_krw)}`)
  }

  const title = tooltipParts.length > 0 ? tooltipParts.join(' · ') : meta.label

  return (
    <span
      className={`cockpit-gcube-sync ${meta.cssClass}`}
      title={title}
      aria-label={`gcube 반영 상태: ${meta.label}${tooltipParts.length ? ` (${title})` : ''}`}
    >
      <span className="cockpit-gcube-sync-icon" aria-hidden>
        {meta.icon}
      </span>
      <span className="cockpit-gcube-sync-label">{meta.label}</span>
      {showDetail && item?.checked_at && (
        <span className="cockpit-gcube-sync-ts">
          {new Date(item.checked_at).toLocaleDateString('ko-KR', {
            month: '2-digit',
            day: '2-digit',
          })}
        </span>
      )}
    </span>
  )
}
