import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const { data, error } = await db
      .from('competitor_product_mapping')
      .select(`
        id, competitor_id, gpu_product_id, competitor_sku, pricing_model,
        competitors!competitor_id(id, name),
        gpu_products!gpu_product_id(id, model_name, memory)
      `)
      .eq('is_active', true)
      .order('competitor_id')

    if (error) throw error

    return NextResponse.json({ mappings: data ?? [] })
  } catch (err) {
    console.error('[market/mappings]', err)
    return NextResponse.json({ error: 'Failed to fetch mappings' }, { status: 500 })
  }
}
