import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MARKET_FRESH_HOURS = 48

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    // 경쟁사 목록
    const { data: competitors, error: compErr } = await db
      .from('competitors')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (compErr) throw compErr

    // 전체 GPU 상품 카탈로그 (가격표와 동일한 기준)
    const { data: allProducts, error: prodErr } = await db
      .from('gpu_products')
      .select('id, model_name, memory, tier, pricing_mode, gpu_count')
      .order('tier')
      .order('model_name')

    if (prodErr) throw prodErr

    // 경쟁사 매핑 (active만)
    const { data: mappings, error: mapErr } = await db
      .from('competitor_product_mapping')
      .select(`
        id, competitor_id, gpu_product_id, competitor_sku, pricing_model, region,
        competitors!competitor_id(id, name, short_name, color, type),
        gpu_products!gpu_product_id(id, model_name, memory, tier)
      `)
      .eq('is_active', true)

    if (mapErr) throw mapErr

    // 각 매핑의 최신 가격
    const mappingIds = (mappings ?? []).map((m: Record<string, unknown>) => m.id as string)
    const { data: latestPrices, error: priceErr } = mappingIds.length > 0
      ? await db
          .from('market_prices')
          .select('mapping_id, price_usd, recorded_at, confidence, notes, source_url')
          .in('mapping_id', mappingIds)
          .order('recorded_at', { ascending: false })
      : { data: [], error: null }

    if (priceErr) throw priceErr

    // 매핑별 최신 가격만 추출
    const latestPriceMap = new Map<string, Record<string, unknown>>()
    for (const p of latestPrices ?? []) {
      const row = p as Record<string, unknown>
      const mid = row.mapping_id as string
      if (!latestPriceMap.has(mid)) {
        latestPriceMap.set(mid, row)
      }
    }

    // gpu_product_id → 매핑 목록 인덱스
    const mappingsByProduct = new Map<string, typeof mappings>()
    for (const m of mappings ?? []) {
      const row = m as Record<string, unknown>
      const pid = row.gpu_product_id as string
      if (!mappingsByProduct.has(pid)) mappingsByProduct.set(pid, [])
      mappingsByProduct.get(pid)!.push(m)
    }

    // 우리 공급 최저가 조회
    const { data: ourPrices, error: ourErr } = await db
      .from('v_lowest_quotes')
      .select('product_id, unit_price_usd, supplier_id')

    if (ourErr) {
      console.warn('[market] v_lowest_quotes error, fallback empty:', ourErr.message)
    }

    const ourPriceMap = new Map<string, Record<string, unknown>>()
    for (const p of ourPrices ?? []) {
      const row = p as Record<string, unknown>
      const pid = row.product_id as string
      if (!ourPriceMap.has(pid)) ourPriceMap.set(pid, row)
    }

    // 전역 마진 설정
    const { data: settings } = await db.from('pricing_settings').select('margin_pct').eq('id', 1).single()
    const globalMargin = (settings?.margin_pct as number) ?? 18

    // 전략 설정 (전역 + 모델별)
    const { data: stratConfigs } = await db
      .from('pricing_strategy_config')
      .select('*')
    const globalStrat = (stratConfigs ?? []).find((s: Record<string, unknown>) => s.scope === 'global') ?? {
      edge_pct_normal: 3, edge_pct_aggressive: 10, margin_pct: 18, concede_margin_pct: 12,
    }
    const stratMap = new Map<string, Record<string, unknown>>()
    for (const s of stratConfigs ?? []) {
      const row = s as Record<string, unknown>
      if (row.scope === 'model_specific' && row.product_id) {
        stratMap.set(row.product_id as string, row)
      }
    }

    // 자체 거래 이력
    const { data: histStats } = await db.from('supply_history_stats').select('*')
    const histMap = new Map<string, Record<string, unknown>>()
    for (const h of histStats ?? []) {
      const row = h as Record<string, unknown>
      histMap.set(row.product_id as string, row)
    }

    const now = Date.now()

    // 전체 상품 기준으로 집계 (LEFT JOIN — 경쟁사 데이터 없어도 포함)
    const products = (allProducts ?? []).map((prod: Record<string, unknown>) => {
      const pid = prod.id as string
      const prodMappings = mappingsByProduct.get(pid) ?? []

      // 각 매핑에 최신 가격 enriched
      const enrichedCompetitors = prodMappings.map((m: Record<string, unknown>) => {
        const priceData = latestPriceMap.get(m.id as string)
        const recordedAt = priceData?.recorded_at as string | undefined
        const hoursAgo = recordedAt
          ? (now - new Date(recordedAt).getTime()) / 3600000
          : null
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
      const marginPct = globalMargin
      const ourSalePrice = supplyMin != null ? supplyMin * (1 + marginPct / 100) : null

      // 전략 설정 (모델별 오버라이드 or 전역)
      const modelStrat = stratMap.get(pid)
      const strategy = {
        edge_pct_normal: (modelStrat?.edge_pct_normal as number) ?? (globalStrat.edge_pct_normal as number),
        edge_pct_aggressive: (modelStrat?.edge_pct_aggressive as number) ?? (globalStrat.edge_pct_aggressive as number),
        margin_pct: (modelStrat?.margin_pct as number) ?? (globalStrat.margin_pct as number),
        concede_margin_pct: (modelStrat?.concede_margin_pct as number) ?? (globalStrat.concede_margin_pct as number),
        is_overridden: !!modelStrat,
      }

      // 자체 거래 이력
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

      // 신선한 가격으로 시장 범위 계산
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
        market_min,
        market_max,
        market_median,
        strategy,
        supply_history: supplyHistory,
      }
    })

    // 요약 통계
    let lowCount = 0, midCount = 0, highCount = 0
    for (const p of products) {
      if (p.our_price_usd == null || p.market_median == null) continue
      const ratio = p.our_price_usd / p.market_median
      if (ratio < 0.9) lowCount++
      else if (ratio <= 1.1) midCount++
      else highCount++
    }

    return NextResponse.json({
      competitors: competitors ?? [],
      products,
      summary: {
        low_count: lowCount,
        mid_count: midCount,
        high_count: highCount,
        competitor_count: (competitors ?? []).length,
      },
    })
  } catch (err) {
    console.error('[pricing/market]', err)
    return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 })
  }
}
