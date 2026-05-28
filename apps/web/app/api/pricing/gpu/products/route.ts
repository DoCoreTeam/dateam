import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const [productsRes, lowestRes, directRes, settingsRes, fxRes] = await Promise.all([
      db.from('gpu_products').select('*').order('tier').order('model_name'),
      db.from('v_lowest_quotes').select('*, suppliers(name, color)'),
      db.from('direct_prices').select('*, gpu_products(id)').eq('is_current', true),
      db.from('pricing_settings').select('margin_pct').eq('id', 1).single(),
      db.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
    ])

    const lowestMap = new Map(
      (lowestRes.data ?? []).map((q: Record<string, unknown>) => [q.product_id as string, q])
    )
    const directMap = new Map(
      (directRes.data ?? []).map((p: Record<string, unknown>) => [(p.gpu_products as Record<string, unknown>)?.id as string, p])
    )

    const marginPct = settingsRes.data?.margin_pct ?? 18
    const usdKrw = fxRes.data?.usd_krw ?? 1400

    const products = (productsRes.data ?? []).map((p: Record<string, unknown>) => {
      const id = p.id as string
      if (p.pricing_mode === 'quote') {
        const lowest = lowestMap.get(id) as Record<string, unknown> | undefined
        const unitPriceUsd = lowest ? Number(lowest.unit_price_usd) : null
        const sellPriceKrw = unitPriceUsd
          ? Math.round(unitPriceUsd * (1 + marginPct / 100) * Number(usdKrw))
          : null
        return {
          ...p,
          lowest_unit_price_usd: unitPriceUsd,
          lowest_supplier: (lowest?.suppliers as Record<string, unknown>) ?? null,
          lowest_valid_until: lowest?.valid_until ?? null,
          sell_price_krw: sellPriceKrw,
          sell_price_usd: unitPriceUsd ? unitPriceUsd * (1 + marginPct / 100) : null,
        }
      } else {
        const direct = directMap.get(id) as Record<string, unknown> | undefined
        const sellPriceKrw = direct ? Number(direct.sell_price_krw) : null
        return {
          ...p,
          lowest_unit_price_usd: null,
          lowest_supplier: null,
          lowest_valid_until: null,
          sell_price_krw: sellPriceKrw,
          sell_price_usd: sellPriceKrw ? sellPriceKrw / Number(usdKrw) : null,
        }
      }
    })

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

    return NextResponse.json({
      products: products.map((p: Record<string, unknown>) => ({
        ...p,
        pending_count: pendingCountMap.get(p.id as string) ?? 0,
      })),
      margin_pct: marginPct,
      usd_krw: usdKrw,
      fx_date: fxRes.data?.rate_date ?? null,
    })
  } catch (err) {
    console.error('[pricing/products]', err)
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}
