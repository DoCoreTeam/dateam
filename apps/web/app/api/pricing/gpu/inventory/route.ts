import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGpuCatalog, modelKeyOf } from '@/lib/gpu/pricing'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

// GET /api/pricing/gpu/inventory — 재고/문의 모델 중심 뷰
export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  // L2 SSOT — effective 가격 + 모델별 공급사 목록 (가용량 0건이어도 공급사 노출)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catalog = await getGpuCatalog(supabase as any)
  const catalogByProduct = new Map(catalog.products.map((p) => [p.id, p]))

  // 상품 목록
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: products, error: pErr } = await (supabase as any)
    .from('gpu_products')
    .select('id, model_name, memory, tier, gpu_count, vcpu, ram_gb, storage_gb, pricing_mode')
    .is('deleted_at', null)
    .order('tier')
    .order('model_name')

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  // 가용량 요약 (v_product_availability_summary)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: availSummary } = await (supabase as any)
    .from('v_product_availability_summary')
    .select('*')

  // 공급사별 최신 가용량 (v_fresh_availability)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: freshAvail } = await (supabase as any)
    .from('v_fresh_availability')
    .select('product_id, supplier_id, status, resp_qty, is_total_capacity, received_at, expires_at, freshness')

  // Tier 3 풀 재고
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: poolStocks } = await (supabase as any)
    .from('direct_pool_stock')
    .select('product_id, pool_qty, set_at, note')
    .eq('is_current', true)
    .is('deleted_at', null)

  // 공급사 정보
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: suppliers } = await (supabase as any)
    .from('suppliers')
    .select('id, name, color, location')

  const supplierMap = new Map((suppliers ?? []).map((s: { id: string; name: string; color: string; location: string | null }) => [s.id, s]))

  const availSummaryMap = new Map((availSummary ?? []).map((a: { product_id: string }) => [a.product_id, a]))
  const poolStockMap = new Map((poolStocks ?? []).map((p: { product_id: string }) => [p.product_id, p]))

  // 상품별 공급사 가용량 그룹핑
  const availByProduct = new Map<string, {
    supplier_id: string | null
    supplier: unknown
    status: string
    resp_qty: number | null
    freshness: string
    received_at: string
    expires_at: string | null
  }[]>()
  for (const fa of (freshAvail ?? [])) {
    const list = availByProduct.get(fa.product_id) ?? []
    list.push({
      ...fa,
      supplier: fa.supplier_id ? supplierMap.get(fa.supplier_id) ?? null : null,
    })
    availByProduct.set(fa.product_id, list)
  }

  const result = (products ?? []).map((p: {
    id: string
    model_name: string
    memory: string
    tier: number
    gpu_count: number
    vcpu: number | null
    ram_gb: number | null
    storage_gb: number | null
    pricing_mode: string
  }) => {
    const summary = availSummaryMap.get(p.id) as {
      fresh_available_qty: number
      oos_supplier_count: number
      stale_count: number
      pending_review_count: number
      latest_response_at: string | null
    } | undefined
    const pool = poolStockMap.get(p.id) as {
      pool_qty: number
      set_at: string
      note: string | null
    } | undefined
    const supplierAvail = availByProduct.get(p.id) ?? []
    const catProd = catalogByProduct.get(p.id)

    // 확정 견적 공급사 목록 (가용량 응답이 없어도 공급사·가격 노출) — 가용 수량은 availByProduct에서 매칭
    const availQtyBySupplier = new Map<string | null, number | null>(
      supplierAvail.map((a) => [a.supplier_id, a.resp_qty])
    )
    const mk = modelKeyOf({ model_name: p.model_name, tier: p.tier })
    const quoteSuppliers = (catalog.suppliersByModel.get(mk) ?? []).map((s) => ({
      supplier_id: s.supplier_id,
      name: s.name,
      color: s.color,
      per_gpu_usd: s.per_gpu_usd,
      unit_price_usd: Math.round(s.per_gpu_usd * p.gpu_count * 10000) / 10000,
      resp_qty: availQtyBySupplier.has(s.supplier_id) ? availQtyBySupplier.get(s.supplier_id) ?? null : null,
      has_qty: availQtyBySupplier.has(s.supplier_id),
    }))

    return {
      ...p,
      fresh_available_qty: summary?.fresh_available_qty ?? 0,
      oos_supplier_count: summary?.oos_supplier_count ?? 0,
      stale_count: summary?.stale_count ?? 0,
      pending_review_count: summary?.pending_review_count ?? 0,
      latest_response_at: summary?.latest_response_at ?? null,
      pool_qty: pool?.pool_qty ?? null,
      pool_set_at: pool?.set_at ?? null,
      pool_note: pool?.note ?? null,
      supplier_availability: supplierAvail,
      // 확정 견적 공급사 목록 (수량 미입력이어도 공급사·가격 표시)
      quote_suppliers: quoteSuppliers,
      // 가격표↔재고 일관: effective(1장당 전파) 사용 → 4개 메뉴 동일 가격
      has_active_quote: catProd?.effective_unit_price_usd != null,
      lowest_unit_price_usd: catProd?.effective_unit_price_usd ?? null,
      effective_unit_price_usd: catProd?.effective_unit_price_usd ?? null,
      effective_supplier: catProd?.effective_supplier ?? null,
      is_propagated: catProd?.is_propagated ?? false,
    }
  })

  return NextResponse.json({ inventory: result })
}
