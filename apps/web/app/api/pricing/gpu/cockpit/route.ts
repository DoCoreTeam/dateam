// GET /api/pricing/gpu/cockpit — 가격 콕핏 통합 데이터 (v2)
//
// 한 행에 [gcube 사이트 가격 / 원가(최저~최고) / 판매가 후보 / 경쟁사 가격(최저~최고) / 전략가]
// 공급사·경쟁사 breakdown은 productIds 일괄 쿼리 후 메모리 분배(N+1 금지).
//
// 삭제: market_median_krw, market_deviation_pct (의미 모호 — competitor_min/max로 대체)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'

/** strategic_history 항목 (Drawer 변경이력용) */
interface StrategicHistoryEntry {
  ts: string
  actor: string
  before: number | null
  after: number | null
  reason: string | null
}

/** 공급사 원가 상세 (펼침용) */
interface CostSupplierEntry {
  supplier_name: string
  unit_price_krw: number
  gpu_count: number
  quote_id: string | null
  basis: string
  is_propagated: boolean
}

/** 경쟁사 가격 상세 (펼침/전환용) */
interface CompetitorEntry {
  company_name: string
  price_krw: number
  recorded_at: string | null
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
    const usdKrw = catalog.usd_krw
    const productIds: string[] = catalog.products.map((p) => p.id)

    if (productIds.length === 0) {
      return NextResponse.json({
        products: [],
        usd_krw: usdKrw,
        fx_date: catalog.fx_date,
        margin_pct: catalog.margin_pct,
      })
    }

    // 2. gcube 사이트 가격 & 공급사 원가 — supply_quotes 일괄 조회 (N+1 방지)
    //    status=confirmed, deleted_at IS NULL, suppliers 조인 (공급사명)
    const { data: allQuotes, error: quotesErr } = await db
      .from('supply_quotes')
      .select('id, product_id, price_type, unit_price_usd, gpu_count, is_selected, suppliers(name)')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .in('product_id', productIds)
      .order('unit_price_usd', { ascending: true })

    if (quotesErr) throw quotesErr

    // 상품별 list 견적(gcube 사이트 가격) 최저 + 해당 quote_id + updated_at
    //  → updated_at 필요: 별도 쿼리로 id 기반 단건 조회 대신 상위 단가 기준 id를 기억하고
    //    gcube_site_updated_at은 list 견적 생성/수정 시각(created_at/updated_at) 제공
    //    → supply_quotes.updated_at 포함 필요. 현재 select에 추가.
    const { data: listQuotesFull, error: listFullErr } = await db
      .from('supply_quotes')
      .select('id, product_id, unit_price_usd, created_at')
      .eq('status', 'confirmed')
      .eq('price_type', 'list')
      .is('deleted_at', null)
      .in('product_id', productIds)
      .order('unit_price_usd', { ascending: true })

    if (listFullErr) throw listFullErr

    // 상품별 gcube 사이트 최저 list 견적 (이미 unit_price_usd asc 정렬 → 첫 번째가 최저)
    const gcubeSiteMap = new Map<string, {
      unit_price_usd: number
      quote_id: string
      updated_at: string | null
    }>()
    for (const q of listQuotesFull ?? []) {
      const row = q as { id: string; product_id: string; unit_price_usd: number; created_at: string | null }
      if (!gcubeSiteMap.has(row.product_id)) {
        gcubeSiteMap.set(row.product_id, {
          unit_price_usd: row.unit_price_usd,
          quote_id: row.id,
          updated_at: row.created_at,
        })
      }
    }

    // 상품별 cost 견적 상세 (공급사 원가 breakdown, 단가 오름차순)
    const costSuppliersMap = new Map<string, CostSupplierEntry[]>()
    // 상품별 cost 원가 최저/최고
    const costMinUsdMap = new Map<string, number>()
    const costMaxUsdMap = new Map<string, number>()

    for (const q of allQuotes ?? []) {
      const row = q as {
        id: string
        product_id: string
        price_type: string
        unit_price_usd: number
        gpu_count: number
        is_selected: boolean
        suppliers: { name: string } | null
      }
      if (row.price_type === 'list') continue  // gcube 공시가는 cost에서 제외

      const usd = Number(row.unit_price_usd)
      const gpuCount = Math.max(1, Number(row.gpu_count) || 1)
      const unitKrw = Math.round(usd * usdKrw)
      const supplierName = row.suppliers?.name ?? '공급사 미지정'
      const basis = row.is_selected ? 'selected' : 'auto'

      // cost_min/max
      const prevMin = costMinUsdMap.get(row.product_id)
      if (prevMin == null || usd < prevMin) costMinUsdMap.set(row.product_id, usd)
      const prevMax = costMaxUsdMap.get(row.product_id)
      if (prevMax == null || usd > prevMax) costMaxUsdMap.set(row.product_id, usd)

      // cost suppliers breakdown (단가 오름차순 — 이미 쿼리 정렬됨)
      const list = costSuppliersMap.get(row.product_id) ?? []
      list.push({
        supplier_name: supplierName,
        unit_price_krw: unitKrw,
        gpu_count: gpuCount,
        quote_id: row.id,
        basis,
        is_propagated: false,
      })
      costSuppliersMap.set(row.product_id, list)
    }

    // 3. 경쟁사 가격 — competitor_product_mapping + market_prices 일괄 조회 (N+1 방지)
    const { data: mappings, error: mapErr } = await db
      .from('competitor_product_mapping')
      .select('id, gpu_product_id, competitors!competitor_id(name)')
      .eq('is_active', true)
      .in('gpu_product_id', productIds)

    if (mapErr) throw mapErr

    const mappingIds: string[] = (mappings ?? []).map(
      (m: { id: string }) => m.id,
    )

    const { data: rawPrices, error: priceErr } =
      mappingIds.length > 0
        ? await db
            .from('market_prices')
            .select('mapping_id, price_usd, recorded_at')
            .in('mapping_id', mappingIds)
            .is('deleted_at', null)
            .order('recorded_at', { ascending: false })
        : { data: [], error: null }

    if (priceErr) throw priceErr

    // 매핑별 최신 가격 (recorded_at DESC → 첫 번째가 최신)
    const latestPriceMap = new Map<string, { price_usd: number | null; recorded_at: string | null }>()
    for (const p of rawPrices ?? []) {
      const row = p as { mapping_id: string; price_usd: number | null; recorded_at: string | null }
      if (!latestPriceMap.has(row.mapping_id)) {
        latestPriceMap.set(row.mapping_id, { price_usd: row.price_usd, recorded_at: row.recorded_at })
      }
    }

    // mapping_id → { gpu_product_id, company_name }
    const mappingMeta = new Map<string, { gpu_product_id: string; company_name: string }>()
    for (const m of mappings ?? []) {
      const row = m as {
        id: string
        gpu_product_id: string
        competitors: { name: string } | null
      }
      mappingMeta.set(row.id, {
        gpu_product_id: row.gpu_product_id,
        company_name: row.competitors?.name ?? '경쟁사 미지정',
      })
    }

    // 상품별 경쟁사 가격 목록 (가격 오름차순)
    const competitorsByProduct = new Map<string, CompetitorEntry[]>()
    const competitorMinUsdMap = new Map<string, number>()
    const competitorMaxUsdMap = new Map<string, number>()

    Array.from(mappingMeta.entries()).forEach(([mid, meta]) => {
      const priceData = latestPriceMap.get(mid)
      if (!priceData || priceData.price_usd == null) return

      const usd = priceData.price_usd
      const krw = Math.round(usd * usdKrw)
      const pid = meta.gpu_product_id

      // min/max
      const prevMin = competitorMinUsdMap.get(pid)
      if (prevMin == null || usd < prevMin) competitorMinUsdMap.set(pid, usd)
      const prevMax = competitorMaxUsdMap.get(pid)
      if (prevMax == null || usd > prevMax) competitorMaxUsdMap.set(pid, usd)

      const list = competitorsByProduct.get(pid) ?? []
      list.push({
        company_name: meta.company_name,
        price_krw: krw,
        recorded_at: priceData.recorded_at,
      })
      competitorsByProduct.set(pid, list)
    })

    // 경쟁사 목록 가격 오름차순 정렬
    Array.from(competitorsByProduct.entries()).forEach(([pid, list]) => {
      competitorsByProduct.set(pid, list.sort((a: CompetitorEntry, b: CompetitorEntry) => a.price_krw - b.price_krw))
    })

    // 4. strategic_history — gpu_audit_logs 일괄 (N+1 방지)
    const { data: auditLogs, error: auditErr } = await db
      .from('gpu_audit_logs')
      .select('product_id, ts, actor, detail')
      .eq('action_type', 'strategic_price_set')
      .in('product_id', productIds)
      .order('ts', { ascending: false })
      .limit(productIds.length * STRATEGIC_HISTORY_LIMIT)

    if (auditErr) throw auditErr

    const strategicHistoryMap = new Map<string, StrategicHistoryEntry[]>()
    for (const log of auditLogs ?? []) {
      const row = log as {
        product_id: string
        ts: string
        actor: string
        detail: Record<string, unknown> | null
      }
      const list = strategicHistoryMap.get(row.product_id) ?? []
      if (list.length >= STRATEGIC_HISTORY_LIMIT) continue

      const detail = row.detail ?? {}
      const after = detail.after as Record<string, unknown> | null
      const before = detail.before as Record<string, unknown> | null
      list.push({
        ts: row.ts,
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

    // 5. 카탈로그 행에 breakdown 병합 → 콕핏 행 조립
    const rows = catalog.products.map((p) => {
      // gcube 사이트 가격
      const gcubeSite = gcubeSiteMap.get(p.id) ?? null
      const gcubeSitePriceKrw = gcubeSite != null
        ? Math.round(gcubeSite.unit_price_usd * usdKrw)
        : null

      // 원가 min/max — 실제 견적 먼저
      const costMinUsd = costMinUsdMap.get(p.id) ?? null
      const costMaxUsd = costMaxUsdMap.get(p.id) ?? null
      let costMinKrw = costMinUsd != null ? Math.round(costMinUsd * usdKrw) : null
      let costMaxKrw = costMaxUsd != null ? Math.round(costMaxUsd * usdKrw) : null
      let costIsPropagated = false

      // 실제 견적 없고 buildCatalog가 전파로 채운 effective가 있으면 전파원가로 보정
      if (costMinKrw == null && p.effective_unit_price_usd != null && p.is_propagated) {
        const propagatedKrw = Math.round(p.effective_unit_price_usd * usdKrw)
        costMinKrw = propagatedKrw
        costMaxKrw = propagatedKrw
        costIsPropagated = true
      }

      // cost_suppliers가 비어있고 전파원가 있으면 전파 1건 제공
      let costSuppliers = costSuppliersMap.get(p.id) ?? []
      if (costSuppliers.length === 0 && costIsPropagated && p.effective_unit_price_usd != null) {
        const supplierName = p.effective_supplier?.name ?? '공급사 미지정'
        costSuppliers = [{
          supplier_name: supplierName,
          unit_price_krw: Math.round(p.effective_unit_price_usd * usdKrw),
          gpu_count: p.gpu_count,
          quote_id: null,
          basis: 'propagated',
          is_propagated: true,
        }]
      }

      // 판매가 후보 = cost_min × (1 + margin_pct/100)
      const candidatePriceKrw = costMinKrw != null
        ? Math.round(costMinKrw * (1 + catalog.margin_pct / 100))
        : null

      // 경쟁사 min/max
      const compMinUsd = competitorMinUsdMap.get(p.id) ?? null
      const compMaxUsd = competitorMaxUsdMap.get(p.id) ?? null
      const competitorMinKrw = compMinUsd != null ? Math.round(compMinUsd * usdKrw) : null
      const competitorMaxKrw = compMaxUsd != null ? Math.round(compMaxUsd * usdKrw) : null

      // effective_supplier → 문자열(클라 crash 방지)
      const effectiveSupplierName: string | null =
        p.effective_supplier?.name ?? null

      // strategic_history
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

        // gcube 사이트 가격 (list 견적 기반)
        gcube_site_price_krw: gcubeSitePriceKrw,
        gcube_site_quote_id: gcubeSite?.quote_id ?? null,
        gcube_site_updated_at: gcubeSite?.updated_at ?? null,

        // 공급사 원가
        cost_min_krw: costMinKrw,
        cost_max_krw: costMaxKrw,
        cost_is_propagated: costIsPropagated,
        cost_suppliers: costSuppliers,

        // 판매가 후보
        candidate_price_krw: candidatePriceKrw,
        margin_pct: catalog.margin_pct,

        // 경쟁사 가격
        competitor_min_krw: competitorMinKrw,
        competitor_max_krw: competitorMaxKrw,
        competitors: competitorsByProduct.get(p.id) ?? [],

        // 전략가 (기존 유지)
        strategic_price_krw: p.strategic_price_krw,
        strategic_krw: p.strategic_krw,
        is_strategic_set: p.is_strategic_set,
        effective_margin_pct: p.effective_margin_pct,
        strategic_history: strategicHistory,

        // 기준 공급가 선정 상태
        basis: p.basis,
        is_propagated: p.is_propagated,
        effective_supplier: effectiveSupplierName,
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
