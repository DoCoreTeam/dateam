// GET /api/pricing/gpu/cockpit — 가격 콕핏 통합 데이터 (v2)
//
// 한 행에 [gcube 사이트 가격 / 원가(최저~최고) / 판매가 후보 / 경쟁사 가격(최저~최고) / 전략가]
// 공급사·경쟁사 breakdown은 productIds 일괄 쿼리 후 메모리 분배(N+1 금지).
//
// 삭제: market_median_krw, market_deviation_pct (의미 모호 — competitor_min/max로 대체)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

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
  /** 이 경쟁사가 공급사로 연결되어 있으면 공급사명, 아니면 null (연계 배지) */
  linked_supplier_name: string | null
  /** 경쟁사 로고 — website 도메인 favicon(별도 컬럼 없이 파생). 없으면 null. */
  logo_url: string | null
}

/** website_url → Google favicon URL(공급사 로고와 동일 방식). 도메인 없으면 null. */
function faviconFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname
    return host ? `https://www.google.com/s2/favicons?sz=128&domain=${host}` : null
  } catch {
    return null
  }
}

const STRATEGIC_HISTORY_LIMIT = 5

export async function GET() {
  try {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
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
      .select('id, product_id, price_type, unit_price_usd, gpu_count, is_selected, source_format, suppliers(name)')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .in('product_id', productIds)
      .order('unit_price_usd', { ascending: true })

    if (quotesErr) throw quotesErr

    // 원가 출처: 상품에 인입된 cost(price_type='cost') + market_link 견적이 있으면 'market_link'
    //   price_type !== 'list'는 'direct' 등도 포함될 수 있어 부정확 → 정확히 인입 cost만 '연계 원가'로 판정
    const marketLinkCostProducts = new Set<string>()
    for (const q of allQuotes ?? []) {
      const row = q as { product_id: string; price_type: string; source_format?: string }
      if (row.price_type === 'cost' && row.source_format === 'market_link') {
        marketLinkCostProducts.add(row.product_id)
      }
    }

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
      .select('id, gpu_product_id, competitors!competitor_id(name, supplier_id, website_url)')
      .eq('is_active', true)
      .in('gpu_product_id', productIds)

    if (mapErr) throw mapErr

    // 연결 공급사 ID → 공급사명 (경쟁사 배지 표시용)
    const linkedSupplierIds = Array.from(
      new Set(
        (mappings ?? [])
          .map((m: { competitors?: { supplier_id?: string | null } | null }) => m.competitors?.supplier_id ?? null)
          .filter((sid: string | null): sid is string => !!sid),
      ),
    )
    const linkedSupplierNameMap = new Map<string, string>()
    if (linkedSupplierIds.length > 0) {
      const { data: linkedSuppliers } = await db
        .from('suppliers')
        .select('id, name')
        .in('id', linkedSupplierIds)
      for (const s of linkedSuppliers ?? []) {
        const row = s as { id: string; name: string }
        linkedSupplierNameMap.set(row.id, row.name)
      }
    }

    const mappingIds: string[] = (mappings ?? []).map(
      (m: { id: string }) => m.id,
    )

    // product → mapping_id[] (통합 표 상세 패널의 시세 이력 시계열 스레딩용)
    const mappingIdsByProduct = new Map<string, string[]>()
    for (const m of (mappings ?? []) as { id: string; gpu_product_id: string }[]) {
      const arr = mappingIdsByProduct.get(m.gpu_product_id) ?? []
      arr.push(m.id)
      mappingIdsByProduct.set(m.gpu_product_id, arr)
    }

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

    // mapping_id → { gpu_product_id, company_name, linked_supplier_name }
    const mappingMeta = new Map<string, { gpu_product_id: string; company_name: string; linked_supplier_name: string | null; logo_url: string | null }>()
    for (const m of mappings ?? []) {
      const row = m as {
        id: string
        gpu_product_id: string
        competitors: { name: string; supplier_id?: string | null; website_url?: string | null } | null
      }
      const supId = row.competitors?.supplier_id ?? null
      mappingMeta.set(row.id, {
        gpu_product_id: row.gpu_product_id,
        company_name: row.competitors?.name ?? '경쟁사 미지정',
        linked_supplier_name: supId ? (linkedSupplierNameMap.get(supId) ?? null) : null,
        logo_url: faviconFromUrl(row.competitors?.website_url),
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
        linked_supplier_name: meta.linked_supplier_name,
        logo_url: meta.logo_url,
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

    // 4-1. gcube 홈페이지 반영 완료 추적 — gpu_products 일괄 조회 (N+1 방지, pricing.ts 불변 R1)
    //   pricing.ts(getGpuCatalog)는 계산식 불변 대상이라 별도 read로 반영 컬럼만 병합한다.
    //   내성: 마이그(091) 미적용 = 컬럼 부재(42703)일 때만 빈 맵 폴백. 그 외 에러(RLS·네트워크 등)는 throw해 숨기지 않음.
    const { data: reflectedRows, error: reflectedErr } = await db
      .from('gpu_products')
      .select('id, gcube_reflected_at, gcube_reflected_by, gcube_reflected_price_krw')
      .in('id', productIds)
      .is('deleted_at', null)

    if (reflectedErr) {
      if (reflectedErr.code === '42703') {
        console.warn('[cockpit] gcube_reflected 컬럼 부재(마이그 091 미적용) — 반영상태 생략')
      } else {
        throw reflectedErr
      }
    }

    const reflectedMap = new Map<string, {
      reflected_at: string | null
      reflected_by: string | null
      reflected_price_krw: number | null
    }>()
    for (const r of reflectedRows ?? []) {
      const row = r as {
        id: string
        gcube_reflected_at: string | null
        gcube_reflected_by: string | null
        gcube_reflected_price_krw: number | null
      }
      reflectedMap.set(row.id, {
        reflected_at: row.gcube_reflected_at,
        reflected_by: row.gcube_reflected_by,
        reflected_price_krw:
          row.gcube_reflected_price_krw != null ? Number(row.gcube_reflected_price_krw) : null,
      })
    }

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

      // 기준 공급원가(cost_basis) = buildCatalog 실효 원가(지정 채택·유효성·전파·폴백 SSOT 반영).
      //   cost_min/max(절대 범위)는 공급사 단가 범위 표시 전용으로 그대로 유지한다.
      //   가격결정(공급원가 표시·판매가 추천)은 반드시 cost_basis를 쓴다.
      //   (사고: v0.7.217 — '공급가 지정'해도 가격결정이 만료된 최저가 기준으로 계산되던 결함)
      const costBasisKrw = p.effective_unit_price_usd != null
        ? Math.round(p.effective_unit_price_usd * usdKrw)
        : costMinKrw

      // 판매가 후보 = 기준 공급원가 × (1 + margin_pct/100)
      const candidatePriceKrw = costBasisKrw != null
        ? Math.round(costBasisKrw * (1 + catalog.margin_pct / 100))
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

      // gcube 홈페이지 반영 완료 추적
      const reflected = reflectedMap.get(p.id) ?? null

      return {
        // 식별 + 스펙(스펙 관리와 동일 데이터 — 상세 스펙 탭 표시용)
        id: p.id,
        model_name: p.model_name,
        memory: p.memory,
        tier: p.tier,
        gpu_count: p.gpu_count,
        series: p.series,
        vcpu: p.vcpu ?? null,
        ram_gb: p.ram_gb ?? null,
        storage_gb: p.storage_gb ?? null,

        // gcube 사이트 가격 (list 견적 기반)
        gcube_site_price_krw: gcubeSitePriceKrw,
        gcube_site_quote_id: gcubeSite?.quote_id ?? null,
        gcube_site_updated_at: gcubeSite?.updated_at ?? null,

        // 공급사 원가 — cost_min/max는 절대 단가 범위(표시 전용).
        cost_min_krw: costMinKrw,
        cost_max_krw: costMaxKrw,
        // 기준 공급원가 — 가격결정(공급원가 표시·판매가 추천)의 SSOT 기준값(지정/실효).
        cost_basis_krw: costBasisKrw,
        // 공급원가 per-GPU 단가(USD) — 전파/실견적 공통. 견적표에 '전파 추정' 행으로 표시.
        cost_unit_usd: p.effective_unit_price_usd ?? null,
        cost_is_propagated: costIsPropagated,
        cost_source: (marketLinkCostProducts.has(p.id) ? 'market_link' : 'quote') as 'market_link' | 'quote',
        cost_suppliers: costSuppliers,

        // 판매가 후보
        candidate_price_krw: candidatePriceKrw,
        // buildCatalog 최종 판매가(공시가 폴백 포함) — 견적 없는 구성도 공시가로 채워짐(가격표 SSOT)
        sell_price_krw: p.sell_price_krw,
        margin_pct: catalog.margin_pct,

        // 경쟁사 가격
        competitor_min_krw: competitorMinKrw,
        competitor_max_krw: competitorMaxKrw,
        competitors: competitorsByProduct.get(p.id) ?? [],
        competitor_mapping_ids: mappingIdsByProduct.get(p.id) ?? [],

        // 전략가 (기존 유지)
        strategic_price_krw: p.strategic_price_krw,
        strategic_krw: p.strategic_krw,
        is_strategic_set: p.is_strategic_set,
        effective_margin_pct: p.effective_margin_pct,
        strategic_history: strategicHistory,

        // gcube 홈페이지 반영 완료 추적 (091)
        gcube_reflected_at: reflected?.reflected_at ?? null,
        gcube_reflected_by: reflected?.reflected_by ?? null,
        gcube_reflected_price_krw: reflected?.reflected_price_krw ?? null,

        // 기준 공급가 선정 상태
        basis: p.basis,
        is_propagated: p.is_propagated,
        effective_supplier: effectiveSupplierName,
        // 전파/상속 모태 견적 id — 파생 구성 [공급가 지정] 시 이 견적을 대상 삼음
        propagation_source_quote_id: p.propagation_source_quote_id ?? null,
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
