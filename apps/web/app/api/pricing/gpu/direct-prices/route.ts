import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

// GET /api/pricing/gpu/direct-prices — 직접 판매가 목록 조회 (C3)
//   ?product_id=xxx  특정 상품만 / 없으면 전체
//   ?page=1&limit=50
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const productId = sp.get('product_id')
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)))
  const offset = (page - 1) * limit

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('direct_prices')
    .select('id, product_id, sell_price_krw, note, set_by, set_at, is_current, gpu_products(id, model_name, memory, gpu_count, tier)', { count: 'exact' })
    .is('deleted_at', null)
    .order('set_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (productId) query = query.eq('product_id', productId)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    direct_prices: data ?? [],
    total: count ?? 0,
    page,
    limit,
  })
}

// DELETE /api/pricing/gpu/direct-prices?product_id= — 직접 판매가 해제(소프트삭제)
//  기존 응답 형태 유지 ({ ok: true })
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const product_id = new URL(req.url).searchParams.get('product_id')
  if (!product_id) return NextResponse.json({ error: 'product_id 필요' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const { error } = await db
    .from('direct_prices')
    .update({ deleted_at: new Date().toISOString(), is_current: false })
    .eq('product_id', product_id)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'direct_price_deleted',
    productId: product_id,
    detail: { by: 'product_id' },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const body = await request.json()
    const { product_id, sell_price_krw, note } = body

    if (!product_id || !sell_price_krw) {
      return NextResponse.json({ error: 'product_id and sell_price_krw required' }, { status: 400 })
    }

    // 이전 current 행 비활성화
    await db
      .from('direct_prices')
      .update({ is_current: false })
      .eq('product_id', product_id)
      .eq('is_current', true)

    const { data, error } = await db
      .from('direct_prices')
      .insert({
        product_id,
        sell_price_krw: Number(sell_price_krw),
        note: note || null,
        set_by: user.email,
        is_current: true,
      })
      .select()
      .single()

    if (error) throw error

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminDb = createAdminClient() as any
    await recordGpuAudit(adminDb, {
      actor: user.email ?? user.id,
      actionType: 'direct_set',
      productId: product_id,
      detail: { sell_price_krw: Number(sell_price_krw), note },
    })

    revalidateGpu()
    return NextResponse.json({ price: data })
  } catch (err) {
    console.error('[direct-prices POST]', err)
    return NextResponse.json({ error: 'Failed to set direct price' }, { status: 500 })
  }
}
