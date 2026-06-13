// GPU 통합 표 — 행 모델(UnifiedRow) + 셀 리졸버(포맷 전용)
//
// UnifiedRow = 한 상품/구성의 모든 보기에 필요한 값의 합집합.
//   - 값은 기존 라우트(cockpit/market/inventory/catalog) 결과를 어댑터가 채운다(P1-3).
//   - resolveCell 은 계산하지 않는다. fmtKRW/fmtUSD 포맷 + GPU_TERMS 라벨만(R1).

import { GPU_TERMS } from './terms'
import { fmtMoneyFromKrw } from './format-price'
import type { CurrencyMode } from './format-price'
import { deviationSignal } from './price-signal'
import type { ViewColumn } from './unified-views'

export interface CurrencyCtx {
  mode: CurrencyMode
  usdKrw: number
}
const DEFAULT_CURRENCY: CurrencyCtx = { mode: 'KRW', usdKrw: 1 }

/** 시장 비교 — 경쟁사별 한 줄(회사명+가격+수집일). cockpit competitors[]에서 어댑터가 채움. */
export interface UnifiedCompetitor {
  company_name: string
  price_krw: number
  recorded_at: string | null
}

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
  competitors: UnifiedCompetitor[] // 경쟁사 횡단 비교(회사명+시장가) — 시장 비교 탭 다행 표
  market_mapping_ids: string[] // 연결된 경쟁사 매핑 전체(매핑 관리·시장가 수정용)
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
export type CellKind = 'text' | 'model' | 'sell' | 'badge'

export interface ResolvedCell {
  text: string
  tone: CellTone
  mono: boolean
  /** 렌더 형태: 기획서 질감(Tier·상태·출처·편차·재고는 배지 pill, 모델은 2줄, 판매가는 강조) */
  kind: CellKind
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

/** 컬럼 1칸 값 해석(포맷·라벨·색조·렌더형태). 계산 없음. 기획서 질감(배지/모노/강조) 반영. */
export function resolveCell(row: UnifiedRow, col: ViewColumn, currency: CurrencyCtx = DEFAULT_CURRENCY): ResolvedCell {
  const mono = !!col.mono
  const money = (krw: number | null) => fmtMoneyFromKrw(krw, currency.mode, currency.usdKrw)
  switch (col.key) {
    case 'model':
      return { text: row.model_name, tone: 'default', mono: false, kind: 'model' }
    case 'tier':
      return { text: tierName(row.tier), tone: tierTone(row.tier), mono: false, kind: 'badge' }
    case 'supplyCost':
      return { text: money(row.supply_cost_krw), tone: 'default', mono, kind: 'text' }
    case 'autoPrice':
      return { text: money(row.auto_price_krw), tone: 'muted', mono, kind: 'text' }
    case 'sellPrice':
      return { text: money(row.sell_price_krw), tone: 'sell', mono, kind: 'sell' }
    case 'margin':
      return {
        text: row.margin_pct == null ? '측정불가' : pct(row.margin_pct),
        tone: row.margin_pct == null ? 'danger' : (row.margin_pct >= 20 ? 'ok' : 'warn'),
        mono, kind: 'badge',
      }
    case 'marketMin':
      return { text: money(row.market_min_krw), tone: 'default', mono, kind: 'text' }
    case 'marketMedian':
      return { text: money(row.market_median_krw), tone: 'default', mono, kind: 'text' }
    case 'marketMax':
      return { text: money(row.market_max_krw), tone: 'default', mono, kind: 'text' }
    case 'marketDev':
      return { text: pct(row.market_dev_pct), tone: devTone(row.market_dev_pct), mono, kind: 'badge' }
    case 'sampleCount':
      return { text: row.sample_count != null ? `${row.sample_count}곳` : '—', tone: 'muted', mono: false, kind: 'text' }
    case 'source':
      return { text: sourceLabel(row.cost_source), tone: sourceTone(row.cost_source), mono: false, kind: 'badge' }
    case 'status':
      return { text: row.status ?? '—', tone: statusTone(row.status), mono: false, kind: row.status ? 'badge' : 'text' }
    case 'supplier':
      return { text: row.supplier_name ?? '—', tone: 'default', mono: false, kind: 'text' }
    case 'availableQty':
      return { text: row.available_qty != null ? `${row.available_qty}장` : '—', tone: 'default', mono, kind: 'text' }
    case 'stockStatus':
      return { text: row.stock_status ?? '—', tone: stockTone(row.stock_status), mono: false, kind: row.stock_status ? 'badge' : 'text' }
    case 'validUntil':
      return { text: row.valid_until ?? '—', tone: 'muted', mono, kind: 'text' }
    case 'partnerTier':
      return { text: row.partner_tier ?? '—', tone: 'default', mono: false, kind: 'text' }
    case 'discountRate':
      return { text: row.discount_rate != null ? `-${(row.discount_rate * 100).toFixed(0)}%` : '—', tone: 'ok', mono, kind: 'badge' }
    case 'customerPrice':
      return { text: money(row.customer_price_krw), tone: 'sell', mono, kind: 'sell' }
    default:
      return { text: '—', tone: 'muted', mono, kind: 'text' }
  }
}

function statusTone(status: string | null): CellTone {
  if (status === T.statusConfirmed) return 'ok'
  if (status === T.statusPending) return 'warn'
  if (status === T.statusExpired || status === T.statusRejected) return 'danger'
  return 'muted'
}

/** Tier 번호 → 라벨. 통합 표는 Tier 1/2/3 숫자 표기. */
export function tierName(tier: number | null): string {
  if (tier === 1 || tier === 2 || tier === 3) return `Tier ${tier}`
  return '—'
}

function tierTone(tier: number | null): CellTone {
  if (tier === 1) return 'ok'
  if (tier === 2) return 'warn'
  if (tier === 3) return 'muted'
  return 'muted'
}

function sourceTone(source: string | null): CellTone {
  if (source === 'market_link') return 'warn' // 추종가
  if (source === 'direct') return 'muted'
  return 'default' // 실견적
}

function stockTone(label: string | null): CellTone {
  if (label === T.stockFull) return 'ok'
  if (label === T.stockPartial) return 'warn'
  if (label === T.stockOut) return 'danger'
  return 'muted'
}
