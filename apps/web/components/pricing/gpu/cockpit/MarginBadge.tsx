// components/pricing/gpu/cockpit/MarginBadge.tsx
// 마진율 시그널 뱃지 — 기존 PriceCockpitTab에서 분리

import { marginSignal } from '@/lib/gpu/price-signal'
import {
  PRICE_SIGNAL_CLASS,
  type PriceSignalKey,
} from '@/lib/tokens/status-colors'

interface MarginBadgeProps {
  pct: number | null
  label?: string
}

export function MarginBadge({ pct, label }: MarginBadgeProps) {
  if (pct == null) return <span className="cockpit-price-sub">—</span>
  const sig = marginSignal(pct) as PriceSignalKey
  const cls = PRICE_SIGNAL_CLASS[sig]
  return (
    <span className={`cockpit-signal ${cls}`} title={label ?? `마진율 ${pct.toFixed(1)}%`}>
      {pct.toFixed(1)}%
    </span>
  )
}
