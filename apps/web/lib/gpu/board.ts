// GPU 한 장 화면 계산 SSOT — 모델마다 어디가 제일 싸고 얼마에 팔면 되나
//
// 말: 판매가 = gcube 사이트 최대 금액, 원가 = 공급사 견적, 시세 = 경쟁사 값, 적정판매가 = 최저 원가 × (1 + 마진), 목표 판매가 = 우리가 정한 값(칼럼 strategic_price_krw)
//
// 줄 = 모델명 + 장당 메모리, 금액 = 원화 1장 1시간 (부가세 별도, 원본에 구분 근거 없음)
// 출처 = 확정 견적(cost) + 경쟁사 시세, 같은 공급사에 둘 다 있으면 견적
// 공급사 칸 수는 폭으로만 정해진다 (supplierSlotCount), 공급사 수는 열 정의에 닿지 않는다
// 화면(/pricing/gpu)과 창구(GET /api/pricing/gpu/board, teamda gpu board list)가 이 파일 하나를 지난다

import { normalizeTerm, termLabel } from './term.ts'
import { kstDateKey } from '../datetime/kst.ts'

export interface BoardProductIn {
  id: string
  model_name: string
  memory: string | null
  gpu_count: number | null
  strategic_price_krw: number | string | null
}

export interface BoardQuoteIn {
  id: string
  product_id: string
  supplier_name: string | null
  unit_price_usd: number | string | null
  per_gpu_usd: number | string | null
  gpu_count: number | null
  original_currency: string | null
  original_price: number | string | null
  original_unit: string | null
  term: string | null
  received_at: string | null
  created_at: string | null
  price_type: string | null
  source_format: string | null
}

export interface BoardMarketIn {
  id: string
  product_id: string
  competitor_name: string | null
  price_usd: number | string | null
  obs_currency: string | null
  obs_amount: number | string | null
  obs_gpu_count: number | null
  obs_pricing_unit: string | null
  observed_at: string | null
  recorded_at: string | null
  source_url: string | null
}

/** gcube 사이트 상품 중 우리 모델에 이어진 것 (gcube_listings, 구성 전체 1시간 원화) */
export interface BoardGcubeIn {
  ser: number
  product_id: string
  max_krw: number | string
  price_changed_at: string | null
}

export interface BoardInput {
  products: BoardProductIn[]
  gcube?: BoardGcubeIn[]
  quotes: BoardQuoteIn[]
  market: BoardMarketIn[]
  margin_pct: number
  usd_krw: number
  fx_date: string | null
}

export type OfferKind = 'quote' | 'market'

export interface BoardOffer {
  id: string
  vendor: string
  kind: OfferKind
  /** 원화 1장 1시간. null = 단위 모름 (순위 밖) */
  krw: number | null
  original_amount: number | null
  original_currency: string | null
  original_unit: string | null
  gpu_count: number
  term: string
  term_label: string
  date: string | null
  source_url: string | null
}

export interface BoardRow {
  key: string
  model: string
  memory_per_gpu_gb: number | null
  products: Array<{ id: string; gpu_count: number; strategic_price_krw: number | null; gcube: { ser: number; max_krw: number; price_changed_at: string | null } | null }>
  /** 공급사마다 가장 싼 값 하나, 싼 순 (같으면 최근 것 먼저). 표 칸은 이 앞에서 N개 */
  vendors: BoardOffer[]
  /** 그 줄의 값 전부, 싼 순, 단위 모름은 맨 아래. 상세 창 */
  offers: BoardOffer[]
  cheapest_krw: number | null
  /** 적정판매가 = 최저 원가 × (1 + 마진), 원가가 없으면 null */
  fair_krw: number | null
  /** 목표 판매가 1장 값 (전략가 구성 총액 ÷ 장수, 장수가 적은 상품 것), 없으면 null */
  target_krw: number | null
  /** 판매가 1장 값 = 이어진 gcube 상품 최대 금액 ÷ 장수 (장수가 적은 상품 것), gcube 미연결이면 null */
  sale_krw: number | null
  sale_ser: number | null
  /** 차이 = 판매가 - 적정판매가, 어느 하나가 없으면 null */
  gap_krw: number | null
  /** 목표 판매가가 gcube 판매가와 같은가 (같은 상품의 구성 총액끼리 비교), 비교할 것이 없으면 null */
  reflected: boolean | null
  latest_date: string | null
}

export interface Board {
  rows: BoardRow[]
  margin_pct: number
  usd_krw: number
  fx_date: string | null
}

/** 표 고정 열(모델, 판매가, 적정판매가, 차이, 최근 일자, 단추)이 차지하는 폭 */
export const BOARD_FIXED_WIDTH_PX = 760
/** 공급사 칸 하나의 최소 폭 */
export const BOARD_SLOT_MIN_PX = 150

/** 표 폭으로 공급사 칸 수를 정한다. 공급사 수는 받지 않는다 */
export function supplierSlotCount(tableWidthPx: number): number {
  const free = tableWidthPx - BOARD_FIXED_WIDTH_PX
  return Math.max(1, Math.floor(free / BOARD_SLOT_MIN_PX))
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 장당 메모리 GB — memory 칸은 구성 총 메모리라 장수로 나눈다 (pricing.ts propKeyOf 와 같은 셈) */
export function memoryPerGpuGb(memory: string | null, gpuCount: number | null): number | null {
  const total = parseFloat((memory ?? '').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(total) || total <= 0) return null
  const count = Math.max(1, Number(gpuCount) || 1)
  return Math.round((total / count) * 10) / 10
}

export function rowKeyOf(p: Pick<BoardProductIn, 'model_name' | 'memory' | 'gpu_count'>): string {
  return `${p.model_name.trim()}|${memoryPerGpuGb(p.memory, p.gpu_count) ?? ''}`
}

/**
 * 같은 회사가 표기만 달리 들어온 것 — 화면에는 한 이름으로 보인다 (저장된 원문은 그대로)
 * 2026-11-04 실측: SoftBank 6건과 ソフトバンク 4건이 다른 업체처럼 섞여 보였다
 */
const VENDOR_DISPLAY: Record<string, string> = {
  'ソフトバンク': 'SoftBank',
  'konst tech': 'Konsttech',
  '베슬AI': 'VESSL AI',
  'NHN클라우드': 'NHN Cloud',
}

export function vendorDisplayName(name: string | null | undefined): string {
  const trimmed = name?.trim() || ''
  return VENDOR_DISPLAY[trimmed] ?? trimmed
}

/** 공급사 이름 비교용 — 「konst tech」와 「Konsttech」를 같은 곳으로 본다 */
export function vendorKeyOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
}

const isKrwHourly = (currency: string | null, unit: string | null) =>
  (currency ?? '').toUpperCase() === 'KRW' && /hr|hour|시간/i.test(unit ?? '')

const isHourly = (unit: string | null) => /hr|hour|시간/i.test(unit ?? '')
/** 단위에 GPU 가 적혀 있으면(USD/GPU·hr) 1장 값, 아니면(KRW/hr) 구성 전체 값 */
const isPerGpuUnit = (unit: string | null) => /gpu|장당/i.test(unit ?? '')

/**
 * 견적 원화 1장 1시간 — 원래 금액을 먼저 읽는다
 * unit_price_usd 는 확정 경로가 1장 값을 넣는데 per_gpu_usd 는 그것을 장수로 또 나눈다 (여러 장 구성에서 틀림)
 * 그래서 시간당 원래 금액이 있으면 그것을, 없을 때만 per_gpu_usd 를 쓴다
 */
function quoteKrw(q: BoardQuoteIn, usdKrw: number): number | null {
  if (!q.original_unit && !q.original_currency) return null
  const count = Math.max(1, Number(q.gpu_count) || 1)
  const original = num(q.original_price)
  const currency = (q.original_currency ?? '').toUpperCase()
  if (original != null && isHourly(q.original_unit) && (currency === 'KRW' || currency === 'USD')) {
    const perGpu = isPerGpuUnit(q.original_unit) ? original : original / count
    return Math.round(currency === 'KRW' ? perGpu : perGpu * usdKrw)
  }
  const perGpu = num(q.per_gpu_usd) ?? (num(q.unit_price_usd) != null ? (num(q.unit_price_usd) as number) / count : null)
  return perGpu == null ? null : Math.round(perGpu * usdKrw)
}

function marketKrw(m: BoardMarketIn, usdKrw: number): number | null {
  if (!m.obs_pricing_unit) return null
  const amount = num(m.obs_amount)
  const count = Math.max(1, Number(m.obs_gpu_count) || 1)
  if (isKrwHourly(m.obs_currency, m.obs_pricing_unit) && amount != null) {
    return Math.round(amount / count)
  }
  const usd = num(m.price_usd)
  return usd == null ? null : Math.round(usd * usdKrw)
}

/** 일자는 한국 날짜로 (UTC 로 자르면 오전 9시 전 값이 하루 앞당겨 보인다) */
function kstDay(v: string | null): string | null {
  return v ? kstDateKey(v) || null : null
}

function quoteOffer(q: BoardQuoteIn, usdKrw: number): BoardOffer {
  const term = normalizeTerm(q.term)
  return {
    id: q.id,
    vendor: vendorDisplayName(q.supplier_name),
    kind: 'quote',
    krw: quoteKrw(q, usdKrw),
    original_amount: num(q.original_price),
    original_currency: q.original_currency,
    original_unit: q.original_unit,
    gpu_count: Math.max(1, Number(q.gpu_count) || 1),
    term,
    term_label: termLabel(term),
    date: kstDay(q.received_at ?? q.created_at),
    source_url: null,
  }
}

function marketOffer(m: BoardMarketIn, usdKrw: number): BoardOffer {
  return {
    id: m.id,
    vendor: vendorDisplayName(m.competitor_name),
    kind: 'market',
    krw: marketKrw(m, usdKrw),
    original_amount: num(m.obs_amount),
    original_currency: m.obs_currency,
    original_unit: m.obs_pricing_unit,
    gpu_count: Math.max(1, Number(m.obs_gpu_count) || 1),
    term: 'on_demand',
    term_label: termLabel('on_demand'),
    date: kstDay(m.observed_at ?? m.recorded_at),
    source_url: m.source_url,
  }
}

/** 싼 순, 같으면 최근 것 먼저, 단위 모름은 맨 아래 */
export function compareOffers(a: BoardOffer, b: BoardOffer): number {
  if (a.krw == null && b.krw == null) return (b.date ?? '').localeCompare(a.date ?? '')
  if (a.krw == null) return 1
  if (b.krw == null) return -1
  if (a.krw !== b.krw) return a.krw - b.krw
  return (b.date ?? '').localeCompare(a.date ?? '')
}

/** 같은 공급사에 견적이 있으면 그 공급사의 시세를 뺀다 */
function preferQuotes(offers: BoardOffer[]): BoardOffer[] {
  const quoted = new Set(offers.filter((o) => o.kind === 'quote').map((o) => vendorKeyOf(o.vendor)))
  return offers.filter((o) => o.kind === 'quote' || !quoted.has(vendorKeyOf(o.vendor)))
}

/** 공급사마다 가장 싼 값 하나 (단위 모름은 칸에 안 올림) */
function bestPerVendor(sorted: BoardOffer[]): BoardOffer[] {
  const seen = new Set<string>()
  const out: BoardOffer[] = []
  for (const o of sorted) {
    if (o.krw == null) continue
    const k = vendorKeyOf(o.vendor)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(o)
  }
  return out
}

/** 적정판매가 — 최저 원가에 마진을 붙인 값 */
export function fairPriceOf(cheapestKrw: number | null, marginPct: number): number | null {
  return cheapestKrw == null ? null : Math.round(cheapestKrw * (1 + marginPct / 100))
}

/** 목표 판매가 1장 값 — 구성 총액을 장수로 나눈다, 장수가 적은 상품의 값을 쓴다 */
export function targetPriceOf(products: BoardRow['products']): number | null {
  const set = products
    .filter((p) => p.strategic_price_krw != null && p.strategic_price_krw > 0)
    .sort((a, b) => a.gpu_count - b.gpu_count)[0]
  return set ? Math.round((set.strategic_price_krw as number) / set.gpu_count) : null
}

/** 판매가 — 이어진 gcube 상품 중 장수가 적은 것, 반영은 그 상품의 목표 판매가 총액과 gcube 최대 금액이 같은가 */
export function saleOf(products: BoardRow['products'], fairKrw: number | null): Pick<BoardRow, 'sale_krw' | 'sale_ser' | 'gap_krw' | 'reflected'> {
  const linked = products.filter((p) => p.gcube).sort((a, b) => a.gpu_count - b.gpu_count)[0]
  if (!linked?.gcube) return { sale_krw: null, sale_ser: null, gap_krw: null, reflected: null }
  const sale = Math.round(linked.gcube.max_krw / linked.gpu_count)
  const targeted = products.filter((p) => p.gcube && p.strategic_price_krw != null && p.strategic_price_krw > 0)
  return {
    sale_krw: sale,
    sale_ser: linked.gcube.ser,
    gap_krw: fairKrw == null ? null : sale - fairKrw,
    reflected: targeted.length === 0 ? null : targeted.every((p) => Math.round(p.strategic_price_krw as number) === Math.round(p.gcube!.max_krw)),
  }
}

/** gcube 는 우리 판매 창구다, 그 값은 원가가 아니라 판매가다 */
export const OWN_SALES_VENDOR_KEY = 'gcube'

function latestOf(offers: BoardOffer[]): string | null {
  return offers.reduce<string | null>((acc, o) => (o.date && (!acc || o.date > acc) ? o.date : acc), null)
}

export function buildBoard(input: BoardInput): Board {
  const usdKrw = input.usd_krw
  const keyByProduct = new Map<string, string>()
  const gcubeByProduct = new Map((input.gcube ?? []).flatMap((g) => {
    const max = num(g.max_krw)
    return max == null ? [] : [[g.product_id, { ser: g.ser, max_krw: max, price_changed_at: g.price_changed_at }] as const]
  }))
  const rowsByKey = new Map<string, { model: string; mem: number | null; products: BoardRow['products']; offers: BoardOffer[] }>()

  for (const p of input.products) {
    const key = rowKeyOf(p)
    keyByProduct.set(p.id, key)
    const row = rowsByKey.get(key) ?? { model: p.model_name.trim(), mem: memoryPerGpuGb(p.memory, p.gpu_count), products: [], offers: [] }
    row.products.push({ id: p.id, gpu_count: Math.max(1, Number(p.gpu_count) || 1), strategic_price_krw: num(p.strategic_price_krw), gcube: gcubeByProduct.get(p.id) ?? null })
    rowsByKey.set(key, row)
  }

  // 공시가(list)는 원가가 아니고, market_link 견적은 시세를 베낀 것이라 시세와 겹친다
  // gcube 견적은 종류와 무관하게 우리 판매가라 원가에서 뺀다 (실측 cost 4건, A100 1장 23,940 이 8장 값)
  for (const q of input.quotes) {
    if (q.price_type === 'list' || q.source_format === 'market_link') continue
    if (vendorKeyOf(q.supplier_name ?? '') === OWN_SALES_VENDOR_KEY) continue
    const row = rowsByKey.get(keyByProduct.get(q.product_id) ?? '')
    if (row) row.offers.push(quoteOffer(q, usdKrw))
  }
  for (const m of input.market) {
    const row = rowsByKey.get(keyByProduct.get(m.product_id) ?? '')
    if (row) row.offers.push(marketOffer(m, usdKrw))
  }

  const rows: BoardRow[] = [...rowsByKey.entries()].map(([key, r]) => {
    const offers = preferQuotes(r.offers).sort(compareOffers)
    const vendors = bestPerVendor(offers)
    const cheapest = vendors[0]?.krw ?? null
    const fair = fairPriceOf(cheapest, input.margin_pct)
    return {
      key,
      model: r.model,
      memory_per_gpu_gb: r.mem,
      products: r.products,
      vendors,
      offers,
      cheapest_krw: cheapest,
      fair_krw: fair,
      target_krw: targetPriceOf(r.products),
      ...saleOf(r.products, fair),
      latest_date: latestOf(offers),
    }
  })

  rows.sort((a, b) => a.model.localeCompare(b.model, 'en', { numeric: true }) || (a.memory_per_gpu_gb ?? 0) - (b.memory_per_gpu_gb ?? 0))
  return { rows, margin_pct: input.margin_pct, usd_krw: usdKrw, fx_date: input.fx_date }
}

/** 목표 판매가 1장 값을 그 줄 상품마다 구성 총액으로 편다 (기존 창구는 상품 단위 총액을 받는다) */
export function strategicItemsFor(row: Pick<BoardRow, 'products'>, perGpuKrw: number): Array<{ product_id: string; strategic_price_krw: number }> {
  return row.products.map((p) => ({ product_id: p.id, strategic_price_krw: Math.round(perGpuKrw * p.gpu_count) }))
}
