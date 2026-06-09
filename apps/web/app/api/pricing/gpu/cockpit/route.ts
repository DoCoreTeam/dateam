// GET /api/pricing/gpu/cockpit — 가격 콕핏 통합 데이터
//
// getGpuCatalog(SSOT) + 시장 median 병합 → 콕핏 UI가 한 행으로 바로 쓸 수 있는 형태.
// deleted_at 필터: getGpuCatalog 내부에서 적용됨.
// market median: buildMarketMedianMap helper(lib/gpu/market-median.ts) 재사용.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'
import { buildMarketMedianMap } from '@/lib/gpu/market-median'

/** strategic_history 항목 (Drawer 변경이력용) */
interface StrategicHistoryEntry {
  ts: string
  actor: string
  before: number | null
  after: number | null
  reason: string | null
}

const STRATEGIC_HISTORY_LIMIT = 5

export async function GET() {
  try {
    const supabase = await createClient()

    // SEC-M1: 인증 가드 — anon 차단
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    // 1. GPU 카탈로그 (SSOT)
    const catalog = await getGpuCatalog(db)

    // 2. 시장 median 계산에 필요한 매핑 + 최신 가격
    const { data: mappings, error: mapErr } = await db
      .from('competitor_product_mapping')
      .select('id, gpu_product_id')
      .eq('is_active', true)

    if (mapErr) throw mapErr

    const mappingIds: string[] = (mappings ?? []).map(
      (m: { id: string }) => m.id,
    )

    const { data: rawPrices, error: priceErr } =
      mappingIds.length > 0
        ? await db
            .from('market_prices')
            .select('mapping_id, price_usd')
            .in('mapping_id', mappingIds)
            .is('deleted_at', null)
            .order('recorded_at', { ascending: false })
        : { data: [], error: null }

    if (priceErr) throw priceErr

    // 매핑별 최신 가격만 추출 (order recorded_at DESC 이므로 첫 번째가 최신)
    const latestPriceMap = new Map<string, { price_usd: number | null }>()
    for (const p of rawPrices ?? []) {
      const row = p as { mapping_id: string; price_usd: number | null }
      if (!latestPriceMap.has(row.mapping_id)) {
        latestPriceMap.set(row.mapping_id, { price_usd: row.price_usd })
      }
    }

    // 3. product_id별 market median/min/max (USD)
    const medianMap = buildMarketMedianMap(
      (mappings ?? []) as Array<{ id: string; gpu_product_id: string }>,
      latestPriceMap,
    )

    const usdKrw = catalog.usd_krw

    // 4. HIGH-3: list(공시) 견적 — price_type='list', cost=null인 상품에 list_price_krw 제공
    // supply_quotes에서 confirmed + price_type='list' + deleted_at IS NULL, 상품별 최저 unit_price_usd
    const productIds: string[] = catalog.products.map((p) => p.id)
    const { data: listQuotes, error: listErr } =
      productIds.length > 0
        ? await db
            .from('supply_quotes')
            .select('product_id, unit_price_usd')
            .eq('status', 'confirmed')
            .eq('price_type', 'list')
            .is('deleted_at', null)
            .in('product_id', productIds)
        : { data: [], error: null }

    if (listErr) throw listErr

    // 상품별 list 견적 최저 unit_price_usd (USD) → KRW 환산
    const listPriceUsdMap = new Map<string, number>()
    for (const q of listQuotes ?? []) {
      const row = q as { product_id: string; unit_price_usd: number }
      const prev = listPriceUsdMap.get(row.product_id)
      if (prev == null || row.unit_price_usd < prev) {
        listPriceUsdMap.set(row.product_id, row.unit_price_usd)
      }
    }

    // 5. HIGH-3: strategic_history — gpu_audit_logs에서 action_type='strategic_price_set' 최근 N건 일괄
    const { data: auditLogs, error: auditErr } =
      productIds.length > 0
        ? await db
            .from('gpu_audit_logs')
            .select('product_id, created_at, actor, detail')
            .eq('action_type', 'strategic_price_set')
            .in('product_id', productIds)
            .order('created_at', { ascending: false })
            // 전체 product × LIMIT 보다 크게 가져와 메모리에서 분배 (N+1 방지)
            .limit(productIds.length * STRATEGIC_HISTORY_LIMIT)
        : { data: [], error: null }

    if (auditErr) throw auditErr

    // 상품별 최근 N건 히스토리 맵 조립
    const strategicHistoryMap = new Map<string, StrategicHistoryEntry[]>()
    for (const log of auditLogs ?? []) {
      const row = log as {
        product_id: string
        created_at: string
        actor: string
        detail: Record<string, unknown> | null
      }
      const list = strategicHistoryMap.get(row.product_id) ?? []
      if (list.length >= STRATEGIC_HISTORY_LIMIT) continue

      const detail = row.detail ?? {}
      const after = detail.after as Record<string, unknown> | null
      const before = detail.before as Record<string, unknown> | null
      list.push({
        ts: row.created_at,
        actor: row.actor,
        before:
          before?.strategic_price_krw != null
            ? Number(before.strategic_price_krw)
            : null,
        after:
          after?.strategic_price_krw != null
            ? Number(after.strategic_price_krw)
            : null,
        reason:
          typeof after?.reason === 'string' ? after.reason : null,
      })
      strategicHistoryMap.set(row.product_id, list)
    }

    // 6. 카탈로그 행에 market median 병합 → 콕핏 행 조립
    const rows = catalog.products.map((p) => {
      const med = medianMap.get(p.id)
      const marketMedianKrw =
        med?.market_median_usd != null
          ? Math.round(med.market_median_usd * usdKrw)
          : null
      const marketMinKrw =
        med?.market_min_usd != null
          ? Math.round(med.market_min_usd * usdKrw)
          : null
      const marketMaxKrw =
        med?.market_max_usd != null
          ? Math.round(med.market_max_usd * usdKrw)
          : null

      // 시장 편차% = (strategic_krw - market_median_krw) / market_median_krw × 100
      const marketDeviationPct =
        p.strategic_krw != null && marketMedianKrw != null && marketMedianKrw > 0
          ? ((p.strategic_krw - marketMedianKrw) / marketMedianKrw) * 100
          : null

      // cost_krw = effective_unit_price_usd × usd_krw (quote 상품만 유효)
      const costKrw =
        p.effective_unit_price_usd != null
          ? Math.round(p.effective_unit_price_usd * usdKrw)
          : null

      // HIGH-1: effective_supplier → 문자열(공급사명) 또는 null (객체 그대로 전달 시 React child 크래시 방지)
      const effectiveSupplierName: string | null =
        p.effective_supplier?.name ?? null

      // HIGH-3: list_price_krw — gcube 공시가(list 견적 unit_price_usd × fx)
      const listPriceUsd = listPriceUsdMap.get(p.id) ?? null
      const listPriceKrw =
        listPriceUsd != null ? Math.round(listPriceUsd * usdKrw) : null

      // HIGH-3: strategic_history
      const strategicHistory: StrategicHistoryEntry[] =
        strategicHistoryMap.get(p.id) ?? []

      return {
        // 식별
        id: p.id,
        model_name: p.model_name,
        memory: p.memory,
        tier: p.tier,
        gpu_count: p.gpu_count,
        series: p.series,
        pricing_mode: p.pricing_mode,

        // 공급원가
        cost_krw: costKrw,

        // 자동마진가 (sell_price_krw = effective × margin)
        auto_margin_krw: p.sell_price_krw,

        // 전략가
        strategic_price_krw: p.strategic_price_krw, // DB 원본 (null=미설정)
        strategic_krw: p.strategic_krw,              // 실효가 (strategic ?? auto)
        is_strategic_set: p.is_strategic_set,

        // 마진
        effective_margin_pct: p.effective_margin_pct,

        // 시장 데이터 (KRW 환산)
        market_median_krw: marketMedianKrw,
        market_min_krw: marketMinKrw,
        market_max_krw: marketMaxKrw,
        market_deviation_pct: marketDeviationPct,

        // 기준가 선정 상태
        basis: p.basis,
        is_propagated: p.is_propagated,

        // HIGH-1: string | null (클라 CockpitProduct.effective_supplier: string | null과 일치)
        effective_supplier: effectiveSupplierName,

        // HIGH-3: 공시가 + 전략가 이력
        list_price_krw: listPriceKrw,
        strategic_history: strategicHistory,
      }
    })

    return NextResponse.json({
      products: rows,
      usd_krw: usdKrw,
      fx_date: catalog.fx_date,
      margin_pct: catalog.margin_pct,
    })
  } catch (err) {
    console.error('[pricing/cockpit]', err)
    return NextResponse.json({ error: 'Failed to fetch cockpit data' }, { status: 500 })
  }
}
