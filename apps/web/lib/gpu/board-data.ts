// GPU 한 장 화면 데이터 읽기 — 창구(GET /api/pricing/gpu/board)가 부르고 계산은 board.ts 가 한다
// 사용자 클라이언트를 받는다, RLS 를 그대로 지난다 (서비스롤 안 씀)

import { buildBoard, type Board, type BoardGcubeIn, type BoardMarketIn, type BoardProductIn, type BoardQuoteIn } from './board.ts'

const PAGE_SIZE = 1000
const DEFAULT_MARGIN_PCT = 18
const DEFAULT_USD_KRW = 1400

interface MarketRow {
  id: string
  mapping_id: string
  price_usd: number | null
  obs_currency: string | null
  obs_amount: number | null
  obs_gpu_count: number | null
  obs_pricing_unit: string | null
  observed_at: string | null
  recorded_at: string | null
  source_url: string | null
}

interface MappingRow {
  id: string
  gpu_product_id: string | null
  competitor_url: string | null
  competitors: { name: string | null } | null
}

interface QuoteRow extends Omit<BoardQuoteIn, 'supplier_name'> {
  suppliers: { name: string | null } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** 시세는 2천 줄이 넘어 한 번에 다 안 온다, 쪽마다 끝까지 읽는다 */
async function readAllMarket(db: Db): Promise<MarketRow[]> {
  const out: MarketRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('market_prices')
      .select('id, mapping_id, price_usd, obs_currency, obs_amount, obs_gpu_count, obs_pricing_unit, observed_at, recorded_at, source_url')
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    out.push(...((data ?? []) as MarketRow[]))
    if (!data || data.length < PAGE_SIZE) return out
  }
}

/** 매핑(경쟁사 × 상품)마다 가장 최근 관측 하나 */
function latestPerMapping(rows: MarketRow[]): MarketRow[] {
  const at = (r: MarketRow) => r.observed_at ?? r.recorded_at ?? ''
  const latest = new Map<string, MarketRow>()
  for (const r of rows) {
    const prev = latest.get(r.mapping_id)
    if (!prev || at(r) > at(prev)) latest.set(r.mapping_id, r)
  }
  return [...latest.values()]
}

function toMarketIn(rows: MarketRow[], mappings: MappingRow[]): BoardMarketIn[] {
  const byId = new Map(mappings.map((m) => [m.id, m]))
  return rows.flatMap((r) => {
    const m = byId.get(r.mapping_id)
    if (!m?.gpu_product_id) return []
    return [{
      id: r.id,
      product_id: m.gpu_product_id,
      competitor_name: m.competitors?.name ?? null,
      price_usd: r.price_usd,
      obs_currency: r.obs_currency,
      obs_amount: r.obs_amount,
      obs_gpu_count: r.obs_gpu_count,
      obs_pricing_unit: r.obs_pricing_unit,
      observed_at: r.observed_at,
      recorded_at: r.recorded_at,
      source_url: r.source_url ?? m.competitor_url,
    }]
  })
}

export async function getGpuBoard(db: Db): Promise<Board> {
  const [productsRes, quotesRes, mappingsRes, settingsRes, fxRes, marketRows, gcubeRes] = await Promise.all([
    db.from('gpu_products')
      .select('id, model_name, memory, gpu_count, strategic_price_krw')
      .is('deleted_at', null)
      .eq('is_active', true),
    db.from('supply_quotes')
      .select('id, product_id, unit_price_usd, per_gpu_usd, gpu_count, original_currency, original_price, original_unit, term, received_at, created_at, price_type, source_format, suppliers(name)')
      .eq('status', 'confirmed')
      .is('deleted_at', null),
    db.from('competitor_product_mapping').select('id, gpu_product_id, competitor_url, competitors(name)'),
    db.from('pricing_settings').select('margin_pct').eq('id', 1).single(),
    db.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
    readAllMarket(db),
    db.from('gcube_listings').select('ser, product_id, max_krw, price_changed_at').not('product_id', 'is', null),
  ])
  for (const res of [productsRes, quotesRes, mappingsRes, gcubeRes]) {
    if (res.error) throw res.error
  }

  const quotes: BoardQuoteIn[] = ((quotesRes.data ?? []) as QuoteRow[]).map(({ suppliers, ...q }) => ({
    ...q,
    supplier_name: suppliers?.name ?? null,
  }))

  return buildBoard({
    products: (productsRes.data ?? []) as BoardProductIn[],
    gcube: (gcubeRes.data ?? []) as BoardGcubeIn[],
    quotes,
    market: toMarketIn(latestPerMapping(marketRows), (mappingsRes.data ?? []) as MappingRow[]),
    margin_pct: Number(settingsRes.data?.margin_pct ?? DEFAULT_MARGIN_PCT),
    usd_krw: Number(fxRes.data?.usd_krw ?? DEFAULT_USD_KRW),
    fx_date: fxRes.data?.rate_date ?? null,
  })
}
