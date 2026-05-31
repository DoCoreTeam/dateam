import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    const { data: stocks } = await admin
      .from('direct_pool_stock')
      .select('product_id, pool_qty, set_at, gpu_products(id, model_name, tier, memory, gpu_count)')
      .eq('is_current', true)
      .eq('is_test', false)
      .order('set_at', { ascending: false })

    const inventory = (stocks ?? []).map((s: Record<string, unknown>) => {
      const product = s.gpu_products as Record<string, unknown> | null
      return {
        product_id: s.product_id,
        model_name: product?.model_name ?? null,
        tier: product?.tier ?? null,
        memory: product?.memory ?? null,
        gpu_count: product?.gpu_count ?? null,
        available_qty: s.pool_qty ?? 0,
        in_stock: ((s.pool_qty as number) ?? 0) > 0,
        updated_at: s.set_at,
      }
    })

    return NextResponse.json(
      {
        success: true,
        data: inventory,
        meta: { total: inventory.length, as_of: new Date().toISOString() },
      },
      { headers: corsHeaders() }
    )
  } catch (err) {
    console.error('[public/v1/inventory GET]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}
