import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'

const MARKET_FRESH_HOURS = 48

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    const { data: fxData } = await admin
      .from('fx_rates')
      .select('usd_krw')
      .order('rate_date', { ascending: false })
      .limit(1)
      .single()
    const usdKrw: number = fxData?.usd_krw ?? 1400

    // 보안: supplier_id(경쟁사↔공급사 연계 — 소싱 기밀)는 공개 응답에서 제외.
    // select('*') 금지 — 명시 컬럼만 노출.
    const { data: competitors, error: compErr } = await admin
      .from('competitors')
      .select('id, name, short_name, color, type, is_active')
      .eq('is_active', true)
      .order('name')
    if (compErr) throw compErr

    const { data: allProducts, error: prodErr } = await admin
      .from('gpu_products')
      .select('id, model_name, memory, tier, pricing_mode, gpu_count')
      .order('tier')
      .order('model_name')
    if (prodErr) throw prodErr

    const { data: mappings, error: mapErr } = await admin
      .from('competitor_product_mapping')
      .select(`
        id, competitor_id, gpu_product_id, competitor_sku, pricing_model, region,
        competitors!competitor_id(id, name, short_name, color, type),
        gpu_products!gpu_product_id(id, model_name, memory, tier)
      `)
      .eq('is_active', true)
    if (mapErr) throw mapErr

    const mappingIds = (mappings ?? []).map((m: Record<string, unknown>) => m.id as string)
    const { data: latestPrices, error: priceErr } = mappingIds.length > 0
      ? await admin
          .from('market_prices')
          .select('mapping_id, price_usd, recorded_at, confidence, notes')
          .in('mapping_id', mappingIds)
          .order('recorded_at', { ascending: false })
      : { data: [], error: null }
    if (priceErr) throw priceErr

    const latestPriceMap = new Map<string, Record<string, unknown>>()
    for (const p of latestPrices ?? []) {
      const row = p as Record<string, unknown>
      const mid = row.mapping_id as string
      if (!latestPriceMap.has(mid)) latestPriceMap.set(mid, row)
    }

    const mappingsByProduct = new Map<string, typeof mappings>()
    for (const m of mappings ?? []) {
      const row = m as Record<string, unknown>
      const pid = row.gpu_product_id as string
      if (!mappingsByProduct.has(pid)) mappingsByProduct.set(pid, [])
      mappingsByProduct.get(pid)!.push(m)
    }

    const { data: ourPrices } = await admin
      .from('v_lowest_quotes')
      .select('product_id, unit_price_usd, supplier_id')

    const ourPriceMap = new Map<string, Record<string, unknown>>()
    for (const p of ourPrices ?? []) {
      const row = p as Record<string, unknown>
      const pid = row.product_id as string
      if (!ourPriceMap.has(pid)) ourPriceMap.set(pid, row)
    }

    const { data: settings } = await admin.from('pricing_settings').select('margin_pct').eq('id', 1).single()
    const globalMargin = (settings?.margin_pct as number) ?? 18

    const { data: stratConfigs } = await admin.from('pricing_strategy_config').select('*')
    const globalStrat = (stratConfigs ?? []).find((s: Record<string, unknown>) => s.scope === 'global') ?? {
      edge_pct_normal: 3, edge_pct_aggressive: 10, margin_pct: 18, concede_margin_pct: 12,
    }
    const stratMap = new Map<string, Record<string, unknown>>()
    for (const s of stratConfigs ?? []) {
      const row = s as Record<string, unknown>
      if (row.scope === 'model_specific' && row.product_id) stratMap.set(row.product_id as string, row)
    }

    const { data: histStats } = await admin.from('supply_history_stats').select('*')
    const histMap = new Map<string, Record<string, unknown>>()
    for (const h of histStats ?? []) {
      const row = h as Record<string, unknown>
      histMap.set(row.product_id as string, row)
    }

    const now = Date.now()

    const products = (allProducts ?? []).map((prod: Record<string, unknown>) => {
      const pid = prod.id as string
      const prodMappings = mappingsByProduct.get(pid) ?? []

      const enrichedCompetitors = prodMappings.map((m: Record<string, unknown>) => {
        const priceData = latestPriceMap.get(m.id as string)
        const recordedAt = priceData?.recorded_at as string | undefined
        const hoursAgo = recordedAt ? (now - new Date(recordedAt).getTime()) / 3600000 : null
        const isFresh = hoursAgo !== null && hoursAgo <= MARKET_FRESH_HOURS
        return {
          mapping_id: m.id,
          competitor: m.competitors,
          competitor_sku: m.competitor_sku,
          pricing_model: m.pricing_model,
          region: m.region,
          price_usd: priceData?.price_usd ?? null,
          recorded_at: recordedAt ?? null,
          hours_ago: hoursAgo !== null ? Math.round(hoursAgo) : null,
          is_fresh: isFresh,
          confidence: priceData?.confidence ?? null,
          notes: priceData?.notes ?? null,
        }
      })

      const ourData = ourPriceMap.get(pid)
      const supplyMin = ourData?.unit_price_usd as number | undefined
      const ourSalePrice = supplyMin != null ? supplyMin * (1 + globalMargin / 100) : null

      const modelStrat = stratMap.get(pid)
      const strategy = {
        edge_pct_normal: (modelStrat?.edge_pct_normal as number) ?? (globalStrat.edge_pct_normal as number),
        edge_pct_aggressive: (modelStrat?.edge_pct_aggressive as number) ?? (globalStrat.edge_pct_aggressive as number),
        margin_pct: (modelStrat?.margin_pct as number) ?? (globalStrat.margin_pct as number),
        concede_margin_pct: (modelStrat?.concede_margin_pct as number) ?? (globalStrat.concede_margin_pct as number),
        is_overridden: !!modelStrat,
      }

      const hist = histMap.get(pid)
      const supplyHistory = hist ? {
        sample_count: hist.sample_count as number,
        min_usd: hist.min_usd as number,
        p25_usd: hist.p25_usd as number,
        median_usd: hist.median_usd as number,
        p75_usd: hist.p75_usd as number,
        max_usd: hist.max_usd as number,
        is_active: hist.is_active as boolean,
      } : null

      const freshPrices = enrichedCompetitors
        .filter((c: { is_fresh: boolean; price_usd: number | null }) => c.is_fresh && c.price_usd != null)
        .map((c: { price_usd: number | null }) => c.price_usd as number)
        .sort((a: number, b: number) => a - b)

      let market_min: number | null = null
      let market_max: number | null = null
      let market_median: number | null = null
      if (freshPrices.length > 0) {
        market_min = freshPrices[0]
        market_max = freshPrices[freshPrices.length - 1]
        const mid = Math.floor(freshPrices.length / 2)
        market_median = freshPrices.length % 2 === 0
          ? (freshPrices[mid - 1] + freshPrices[mid]) / 2
          : freshPrices[mid]
      }

      return {
        product: prod,
        competitors: enrichedCompetitors,
        our_price_usd: ourSalePrice,
        current_supply_usd: supplyMin ?? null,
        market_min, market_max, market_median,
        strategy,
        supply_history: supplyHistory,
      }
    })

    let lowCount = 0, midCount = 0, highCount = 0
    for (const p of products) {
      if (p.our_price_usd == null || p.market_median == null) continue
      const ratio = p.our_price_usd / p.market_median
      if (ratio < 0.9) lowCount++
      else if (ratio <= 1.1) midCount++
      else highCount++
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          competitors: competitors ?? [],
          products,
          usd_krw: usdKrw,
          summary: {
            low_count: lowCount,
            mid_count: midCount,
            high_count: highCount,
            competitor_count: (competitors ?? []).length,
          },
        },
      },
      { headers: corsHeaders() }
    )
  } catch (err) {
    console.error('[public/v1/market GET]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}
