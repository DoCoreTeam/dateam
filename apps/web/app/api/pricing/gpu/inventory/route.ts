import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/pricing/gpu/inventory — 재고/문의 모델 중심 뷰
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  // 상품 목록
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: products, error: pErr } = await (supabase as any)
    .from('gpu_products')
    .select('id, model_name, memory, tier, gpu_count, vcpu, ram_gb, storage_gb, pricing_mode')
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

  // 확정 견적 보유 여부 (가격표↔재고 일관 — 견적 있으면 "공급 가능" 신호)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lowestQuotes } = await (supabase as any)
    .from('v_lowest_quotes')
    .select('product_id, unit_price_usd')
  const quoteMap = new Map((lowestQuotes ?? []).map((q: { product_id: string; unit_price_usd: number }) => [q.product_id, q.unit_price_usd]))

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
      // 가격표↔재고 일관: 확정 견적이 있으면 가용량 응답이 없어도 "공급 가능"으로 표시
      has_active_quote: quoteMap.has(p.id),
      lowest_unit_price_usd: quoteMap.get(p.id) ?? null,
    }
  })

  return NextResponse.json({ inventory: result })
}
