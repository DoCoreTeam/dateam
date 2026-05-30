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

    // 최신 시장 가격 (매핑 + 가격 + 상품 정보 JOIN)
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
          .select('mapping_id, price_usd, recorded_at, confidence, notes')
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

    // 데이터 조합
    const now = Date.now()
    const enriched = (mappings ?? []).map((m: Record<string, unknown>) => {
      const priceData = latestPriceMap.get(m.id as string)
      const recordedAt = priceData?.recorded_at as string | undefined
      const hoursAgo = recordedAt
        ? (now - new Date(recordedAt).getTime()) / 3600000
        : null
      const isFresh = hoursAgo !== null && hoursAgo <= MARKET_FRESH_HOURS

      return {
        mapping_id: m.id,
        competitor: m.competitors,
        product: m.gpu_products,
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

    // 우리 판매가(공급 최저가 기반) 조회
    const { data: ourPrices, error: ourErr } = await db
      .from('v_lowest_quotes')
      .select('product_id, unit_price_usd, margin_pct')

    if (ourErr) {
      console.warn('[market] v_lowest_quotes error, fallback empty:', ourErr.message)
    }

    const ourPriceMap = new Map<string, Record<string, unknown>>()
    for (const p of ourPrices ?? []) {
      const row = p as Record<string, unknown>
      const pid = row.product_id as string
      if (!ourPriceMap.has(pid)) {
        ourPriceMap.set(pid, row)
      }
    }

    // 상품별 집계 (포지셔닝 계산)
    const productMap = new Map<string, {
      product: Record<string, unknown>,
      competitors: typeof enriched,
      our_price_usd: number | null,
      market_min: number | null,
      market_max: number | null,
      market_median: number | null,
    }>()

    for (const item of enriched) {
      const pid = (item.product as Record<string, unknown>)?.id as string
      if (!pid) continue
      if (!productMap.has(pid)) {
        const ourData = ourPriceMap.get(pid)
        const supplyMin = ourData?.unit_price_usd as number | undefined
        const marginPct = (ourData?.margin_pct as number | undefined) ?? 18
        const ourSalePrice = supplyMin != null ? supplyMin * (1 + marginPct / 100) : null

        productMap.set(pid, {
          product: item.product as Record<string, unknown>,
          competitors: [],
          our_price_usd: ourSalePrice,
          market_min: null,
          market_max: null,
          market_median: null,
        })
      }
      productMap.get(pid)!.competitors.push(item)
    }

    // 시장 범위 계산 (신선한 가격만)
    for (const entry of Array.from(productMap.values())) {
      const freshPrices = entry.competitors
        .filter((c: Record<string, unknown>) => c.is_fresh && c.price_usd != null)
        .map((c: Record<string, unknown>) => c.price_usd as number)
        .sort((a: number, b: number) => a - b)

      if (freshPrices.length > 0) {
        entry.market_min = freshPrices[0]
        entry.market_max = freshPrices[freshPrices.length - 1]
        const mid = Math.floor(freshPrices.length / 2)
        entry.market_median = freshPrices.length % 2 === 0
          ? (freshPrices[mid - 1] + freshPrices[mid]) / 2
          : freshPrices[mid]
      }
    }

    const products = Array.from(productMap.values())
      .sort((a, b) => {
        const ta = (a.product.tier as number) ?? 99
        const tb = (b.product.tier as number) ?? 99
        if (ta !== tb) return ta - tb
        return ((a.product.model_name as string) ?? '').localeCompare(b.product.model_name as string)
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
