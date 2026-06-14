import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

// GET /api/pricing/gpu/direct-prices — 직접 판매가 목록 조회 (C3)
//   ?product_id=xxx  특정 상품만 / 없으면 전체
//   ?page=1&limit=50
export async function GET(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
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
  if (error) {
    console.error('[direct-prices GET]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

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

  if (error) {
    console.error('[direct-prices DELETE]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

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
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const { product_id, sell_price_krw, note } = body as {
    product_id?: unknown; sell_price_krw?: unknown; note?: unknown
  }

  if (!product_id || typeof product_id !== 'string') {
    return NextResponse.json({ error: 'product_id 필수' }, { status: 400 })
  }
  const priceNum = Number(sell_price_krw)
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return NextResponse.json({ error: 'sell_price_krw는 양수여야 합니다' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id

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
      sell_price_krw: priceNum,
      note: (typeof note === 'string' && note.trim()) ? note.trim() : null,
      set_by: actor,
      is_current: true,
    })
    .select()
    .single()

  if (error) {
    console.error('[direct-prices POST]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor,
    actionType: 'direct_set',
    productId: product_id,
    detail: { sell_price_krw: priceNum, note },
  })

  revalidateGpu()
  return NextResponse.json({ price: data })
}
