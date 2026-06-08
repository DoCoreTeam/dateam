import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// GET /api/pricing/gpu/pool-stock?product_id=xxx
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('product_id')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('direct_pool_stock')
    .select('id, product_id, pool_qty, note, set_by, set_at, is_current')
    .eq('is_current', true)
    .is('deleted_at', null)
    .order('set_at', { ascending: false })

  if (productId) query = query.eq('product_id', productId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ stocks: data ?? [] })
}

// POST /api/pricing/gpu/pool-stock — Tier 3 풀 재고 업데이트
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const user = auth.user

  let body: {
    product_id?: unknown
    pool_qty?: unknown
    note?: unknown
    sell_price_krw?: unknown
    is_test?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const productId = typeof body.product_id === 'string' ? body.product_id : null
  const rawPoolQty = typeof body.pool_qty === 'number' ? body.pool_qty : null
  const poolQty = (rawPoolQty !== null && Number.isFinite(rawPoolQty)) ? Math.max(0, Math.round(rawPoolQty)) : null
  const rawSellPrice = typeof body.sell_price_krw === 'number' ? body.sell_price_krw : null
  const sellPriceKrw = (rawSellPrice !== null && Number.isFinite(rawSellPrice)) ? rawSellPrice : null
  const isTest = body.is_test === true

  if (!productId) return NextResponse.json({ error: 'product_id 필수' }, { status: 400 })
  if (poolQty === null) return NextResponse.json({ error: 'pool_qty 필수' }, { status: 400 })

  const actor = user.email ?? user.id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = createAdminClient() as any

  // 이전 current 행 비활성화 — service_role 전용 RLS
  await adminClient
    .from('direct_pool_stock')
    .update({ is_current: false })
    .eq('product_id', productId)
    .eq('is_current', true)

  // 새 행 삽입 — service_role 전용 RLS
  const { data: newStock, error } = await adminClient
    .from('direct_pool_stock')
    .insert({
      product_id: productId,
      pool_qty: poolQty,
      note: typeof body.note === 'string' ? body.note : null,
      set_by: actor,
      is_current: true,
      is_test: isTest,
    })
    .select()
    .single()

  if (error) {
    console.error('[pool-stock POST]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  // 판매가도 같이 변경하는 경우 direct_prices 업데이트 (service_role 전용 RLS)
  if (sellPriceKrw !== null) {
    await adminClient
      .from('direct_prices')
      .update({ is_current: false })
      .eq('product_id', productId)
      .eq('is_current', true)

    await adminClient
      .from('direct_prices')
      .insert({
        product_id: productId,
        sell_price_krw: sellPriceKrw,
        note: typeof body.note === 'string' ? body.note : null,
        set_by: actor,
        is_current: true,
      })
  }

  // audit_log SSOT — recordGpuAudit 경유
  await recordGpuAudit(adminClient, {
    actor,
    actionType: 'pool_stock_changed',
    productId,
    detail: {
      pool_qty: poolQty,
      sell_price_krw: sellPriceKrw,
      is_test: isTest,
    },
  })

  revalidateGpu()
  return NextResponse.json({ stock: newStock })
}
