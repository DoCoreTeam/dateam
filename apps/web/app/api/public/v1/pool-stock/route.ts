import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireAdminKey, requireMemberKey } from '@/lib/publicApiAuth'
import { responseHeaders } from '@/lib/public-api/respond'
import { createAdminClient } from '@/lib/supabase/server'
import { withWriteAudit } from '@/lib/public-api/write-audit'

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error
  // 내부 창구가 requireMemberApi 인 자료다, 외부용 api_user 키는 막는다
  const denied = requireMemberKey(auth.ctx, request)
  if (denied) return denied

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('product_id')

    let query = admin
      .from('direct_pool_stock')
      .select('id, product_id, pool_qty, note, set_by, set_at, is_current')
      .eq('is_current', true)
      .order('set_at', { ascending: false })

    if (productId) query = query.eq('product_id', productId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json(
      { success: true, data: data ?? [], meta: { total: (data ?? []).length } },
      { headers: responseHeaders({ ctx: auth.ctx, request }) }
    )
  } catch (err) {
    console.error('[public/v1/pool-stock GET]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: responseHeaders({ ctx: auth.ctx, request }) }
    )
  }
}

export async function POST(request: NextRequest) {
  return withWriteAudit('public.pool-stock.post', async () => {
    const auth = await authenticatePublicApi(request)
    if ('error' in auth) return auth.error
    // 내부 창구가 requireAdminApi 인 쓰기다, 키도 같은 선을 지킨다
    const denied = requireAdminKey(auth.ctx, request)
    if (denied) return denied

    try {
      let body: {
        product_id?: unknown
        pool_qty?: unknown
        note?: unknown
        sell_price_krw?: unknown
      }
      try { body = await request.json() } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid JSON body' },
          { status: 400, headers: responseHeaders({ ctx: auth.ctx, request }) }
        )
      }

      const productId = typeof body.product_id === 'string' ? body.product_id : null
      const poolQty = typeof body.pool_qty === 'number' ? Math.max(0, Math.round(body.pool_qty)) : null
      const sellPriceKrw = typeof body.sell_price_krw === 'number' ? body.sell_price_krw : null

      if (!productId) {
        return NextResponse.json(
          { success: false, error: 'product_id is required' },
          { status: 400, headers: responseHeaders({ ctx: auth.ctx, request }) }
        )
      }
      if (poolQty === null) {
        return NextResponse.json(
          { success: false, error: 'pool_qty is required (number)' },
          { status: 400, headers: responseHeaders({ ctx: auth.ctx, request }) }
        )
      }

      const actor = `api:${auth.ctx.keyId}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any

      await admin.from('direct_pool_stock').update({ is_current: false }).eq('product_id', productId).eq('is_current', true)

      const { data: newStock, error } = await admin
        .from('direct_pool_stock')
        .insert({
          product_id: productId,
          pool_qty: poolQty,
          note: typeof body.note === 'string' ? body.note : null,
          set_by: actor,
          is_current: true,
          is_test: false,
        })
        .select()
        .single()

      if (error) throw error

      if (sellPriceKrw !== null) {
        await admin.from('direct_prices').update({ is_current: false }).eq('product_id', productId).eq('is_current', true)
        await admin.from('direct_prices').insert({
          product_id: productId,
          sell_price_krw: sellPriceKrw,
          note: typeof body.note === 'string' ? body.note : null,
          set_by: actor,
          is_current: true,
        })
      }

      await admin.from('gpu_audit_logs').insert({
        actor,
        action_type: 'pool_stock_changed',
        product_id: productId,
        detail: { pool_qty: poolQty, sell_price_krw: sellPriceKrw },
      })

      return NextResponse.json(
        { success: true, data: newStock },
        { status: 201, headers: responseHeaders({ ctx: auth.ctx, request }) }
      )
    } catch (err) {
      console.error('[public/v1/pool-stock POST]', err)
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500, headers: responseHeaders({ ctx: auth.ctx, request }) }
      )
    }
  })(request, undefined)
}
