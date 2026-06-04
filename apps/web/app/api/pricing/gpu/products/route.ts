import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'

// GET /api/pricing/gpu/products — 가격표/고객판매가 공용 (L2 SSOT 경유)
export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const catalog = await getGpuCatalog(db)

    // pending count per product
    const pendingRes = await db
      .from('supply_quotes')
      .select('product_id')
      .eq('status', 'pending')

    const pendingCountMap = new Map<string, number>()
    for (const row of pendingRes.data ?? []) {
      const pid = row.product_id as string
      pendingCountMap.set(pid, (pendingCountMap.get(pid) ?? 0) + 1)
    }

    // effective(1장당 전파)를 legacy 필드명에 매핑 → 기존 UI 호환 + 메뉴 정합
    const products = catalog.products.map((p) => ({
      id: p.id,
      model_name: p.model_name,
      memory: p.memory,
      tier: p.tier,
      pricing_mode: p.pricing_mode,
      gpu_count: p.gpu_count,
      vcpu: p.vcpu,
      ram_gb: p.ram_gb,
      storage_gb: p.storage_gb,
      series: p.series,
      // legacy 호환 (effective = 1장당 전파 반영값)
      lowest_unit_price_usd: p.effective_unit_price_usd,
      lowest_supplier: p.effective_supplier,
      lowest_valid_until: p.own_valid_until,
      sell_price_krw: p.sell_price_krw,
      sell_price_usd: p.sell_price_usd,
      // 신규 SSOT 필드
      per_gpu_usd: p.per_gpu_usd,
      effective_unit_price_usd: p.effective_unit_price_usd,
      effective_supplier: p.effective_supplier,
      is_propagated: p.is_propagated,
      own_lowest_usd: p.own_lowest_usd,
      own_supplier: p.own_supplier,
      // 기준 공급가 채택 상태
      basis: p.basis,
      selected_supplier: p.selected_supplier,
      fallback_reason: p.fallback_reason,
      pending_count: pendingCountMap.get(p.id) ?? 0,
    }))

    return NextResponse.json({
      products,
      margin_pct: catalog.margin_pct,
      usd_krw: catalog.usd_krw,
      fx_date: catalog.fx_date,
    })
  } catch (err) {
    console.error('[pricing/products]', err)
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}
