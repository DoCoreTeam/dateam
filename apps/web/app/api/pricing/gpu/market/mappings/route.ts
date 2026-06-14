import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

// POST /api/pricing/gpu/market/mappings — 경쟁사-제품 매핑 생성
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const competitor_id = body.competitor_id, gpu_product_id = body.gpu_product_id
  if (!competitor_id || !gpu_product_id) return NextResponse.json({ error: 'competitor_id·gpu_product_id 필요' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from('competitor_product_mapping').insert({
    competitor_id, gpu_product_id,
    competitor_sku: (typeof body.competitor_sku === 'string' && body.competitor_sku.trim()) || null,
    competitor_url: (typeof body.competitor_url === 'string' && body.competitor_url.trim()) || null,
    pricing_model: body.pricing_model || 'on_demand',
    region: (typeof body.region === 'string' && body.region.trim()) || null,
    is_active: true,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mapping: data })
}

export async function GET() {
  try {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
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
