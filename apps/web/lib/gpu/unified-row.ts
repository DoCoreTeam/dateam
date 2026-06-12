// GPU 통합 표 — 행 모델(UnifiedRow) + 셀 리졸버(포맷 전용)
//
// UnifiedRow = 한 상품/구성의 모든 보기에 필요한 값의 합집합.
//   - 값은 기존 라우트(cockpit/market/inventory/catalog) 결과를 어댑터가 채운다(P1-3).
//   - resolveCell 은 계산하지 않는다. fmtKRW/fmtUSD 포맷 + GPU_TERMS 라벨만(R1).

import { GPU_TERMS } from './terms'
import { fmtKRW } from './format-price'
import { deviationSignal } from './price-signal'
import type { ViewColumn } from './unified-views'

export interface UnifiedRow {
  id: string
  model_name: string
  memory: string | null
  tier: number | null
  // 가격
  supply_cost_krw: number | null
  auto_price_krw: number | null
  sell_price_krw: number | null
  margin_pct: number | null
  cost_source: string | null // 'market_link' → 추종가, 그 외 → 실견적/직판
  // 시장
  market_min_krw: number | null
  market_median_krw: number | null
  market_max_krw: number | null
  market_dev_pct: number | null
  sample_count: number | null
  market_mapping_id: string | null
  // 재고
  supplier_name: string | null
  available_qty: number | null
  stock_status: string | null // GPU_TERMS 기준 라벨(전량 가용/일부 가용/품절 등)
  valid_until: string | null
  // 고객가
  partner_tier: string | null
  discount_rate: number | null // 0.12 = 12%
  customer_price_krw: number | null
  // 상태
  status: string | null // 확정/검토 대기/만료/반려/대체됨
}

export type CellTone = 'default' | 'sell' | 'ok' | 'warn' | 'danger' | 'muted'

export interface ResolvedCell {
  text: string
  tone: CellTone
  mono: boolean
}

const T = GPU_TERMS

function pct(v: number | null): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(0)}%`
}

function sourceLabel(source: string | null): string {
  if (source === 'market_link') return T.followPrice // 추종가
  if (source === 'direct') return '직접설정'
  return T.realQuote // 실견적
}

function devTone(v: number | null): CellTone {
  if (v == null) return 'muted'
  // 편차 신호는 price-signal.ts SSOT 재사용(색맵/임계 복붙 금지 §3-1).
  switch (deviationSignal(v)) {
    case 'cheap': return 'ok'      // 우리가 저렴 — 경쟁력
    case 'expensive': return 'danger' // 우리가 비쌈
    default: return 'warn'         // 시장가 근접
  }
}

/** 컬럼 1칸 값 해석(포맷·라벨·색조). 계산 없음. */
export function resolveCell(row: UnifiedRow, col: ViewColumn): ResolvedCell {
  const mono = !!col.mono
  switch (col.key) {
    case 'model':
      return { text: row.model_name, tone: 'default', mono: false }
    case 'tier':
      return { text: row.tier != null ? `Tier ${row.tier}` : '—', tone: 'muted', mono: false }
    case 'supplyCost':
      return { text: fmtKRW(row.supply_cost_krw), tone: 'default', mono }
    case 'autoPrice':
      return { text: fmtKRW(row.auto_price_krw), tone: 'muted', mono }
    case 'sellPrice':
      return { text: fmtKRW(row.sell_price_krw), tone: 'sell', mono }
    case 'margin':
      return {
        text: row.margin_pct == null ? '측정불가' : pct(row.margin_pct),
        tone: row.margin_pct == null ? 'danger' : 'default',
        mono,
      }
    case 'marketMin':
      return { text: fmtKRW(row.market_min_krw), tone: 'default', mono }
    case 'marketMedian':
      return { text: fmtKRW(row.market_median_krw), tone: 'default', mono }
    case 'marketMax':
      return { text: fmtKRW(row.market_max_krw), tone: 'default', mono }
    case 'marketDev':
      return { text: pct(row.market_dev_pct), tone: devTone(row.market_dev_pct), mono }
    case 'sampleCount':
      return { text: row.sample_count != null ? `${row.sample_count}곳` : '—', tone: 'muted', mono: false }
    case 'source':
      return { text: sourceLabel(row.cost_source), tone: 'muted', mono: false }
    case 'status':
      return { text: row.status ?? '—', tone: statusTone(row.status), mono: false }
    case 'supplier':
      return { text: row.supplier_name ?? '—', tone: 'default', mono: false }
    case 'availableQty':
      return { text: row.available_qty != null ? `${row.available_qty}장` : '—', tone: 'default', mono }
    case 'stockStatus':
      return { text: row.stock_status ?? '—', tone: stockTone(row.stock_status), mono: false }
    case 'validUntil':
      return { text: row.valid_until ?? '—', tone: 'muted', mono }
    case 'partnerTier':
      return { text: row.partner_tier ?? '—', tone: 'default', mono: false }
    case 'discountRate':
      return { text: row.discount_rate != null ? `-${(row.discount_rate * 100).toFixed(0)}%` : '—', tone: 'ok', mono }
    case 'customerPrice':
      return { text: fmtKRW(row.customer_price_krw), tone: 'sell', mono }
    default:
      return { text: '—', tone: 'muted', mono }
  }
}

function statusTone(status: string | null): CellTone {
  if (status === T.statusConfirmed) return 'ok'
  if (status === T.statusPending) return 'warn'
  if (status === T.statusExpired || status === T.statusRejected) return 'danger'
  return 'muted'
}

function stockTone(label: string | null): CellTone {
  if (label === T.stockFull) return 'ok'
  if (label === T.stockPartial) return 'warn'
  if (label === T.stockOut) return 'danger'
  return 'muted'
}
