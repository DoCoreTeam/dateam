import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

// GET /api/pricing/gpu/availability?product_id=xxx — 가용량 요약
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('product_id')

  if (productId) {
    // 특정 상품의 공급사별 가용량 상세
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: responses, error } = await (supabase as any)
      .from('v_fresh_availability')
      .select('product_id, supplier_id, status, resp_qty, is_total_capacity, received_at, expires_at, freshness')
      .eq('product_id', productId)
      .order('received_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // 공급사 정보 조인
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: suppliers } = await (supabase as any)
      .from('suppliers')
      .select('id, name, color, location')

    const supplierMap = new Map((suppliers ?? []).map((s: { id: string; name: string; color: string; location: string | null }) => [s.id, s]))
    const enriched = (responses ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      supplier: r.supplier_id ? supplierMap.get(r.supplier_id as string) ?? null : null,
    }))

    return NextResponse.json({ responses: enriched })
  }

  // 전체 상품 가용량 요약
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: summary, error } = await (supabase as any)
    .from('v_product_availability_summary')
    .select('*')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ summary: summary ?? [] })
}

// POST /api/pricing/gpu/availability — 가용량 응답 등록
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const supabase = await createClient()
  const adminClient = createAdminClient()
  const user = auth.user

  let body: {
    product_id?: unknown
    supplier_id?: unknown
    status?: unknown
    resp_qty?: unknown
    our_qty?: unknown
    is_total_capacity?: unknown
    unit_price_usd?: unknown
    channel?: unknown
    received_at?: unknown
    inquiry_id?: unknown
    review_item_id?: unknown
    is_test?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const productId = typeof body.product_id === 'string' ? body.product_id : null
  const status = typeof body.status === 'string' ? body.status : null
  const validStatuses = ['available_full', 'available_partial', 'out_of_stock', 'declined', 'pending']

  if (!productId) return NextResponse.json({ error: 'product_id 필수' }, { status: 400 })
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json({ error: `status는 ${validStatuses.join('|')} 중 하나` }, { status: 400 })
  }

  const receivedAt = typeof body.received_at === 'string' ? body.received_at : new Date().toISOString()
  const expiresAt = new Date(receivedAt)
  expiresAt.setHours(expiresAt.getHours() + 72) // 72h freshness

  const actor = user.email ?? user.id
  const supplierId = typeof body.supplier_id === 'string' ? body.supplier_id : null

  // 이전 current 비활성화 (같은 product×supplier 조합)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deactivateQuery = (supabase as any)
    .from('availability_responses')
    .update({ is_current: false })
    .eq('product_id', productId)
    .eq('is_current', true)

  if (supplierId) deactivateQuery = deactivateQuery.eq('supplier_id', supplierId)
  else deactivateQuery = deactivateQuery.is('supplier_id', null)

  await deactivateQuery

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newRecord, error } = await (supabase as any)
    .from('availability_responses')
    .insert({
      product_id: productId,
      supplier_id: supplierId,
      inquiry_id: typeof body.inquiry_id === 'string' ? body.inquiry_id : null,
      review_item_id: typeof body.review_item_id === 'string' ? body.review_item_id : null,
      our_qty: typeof body.our_qty === 'number' ? body.our_qty : null,
      status,
      resp_qty: typeof body.resp_qty === 'number' ? Math.max(0, body.resp_qty) : null,
      is_total_capacity: body.is_total_capacity === true,
      unit_price_usd: typeof body.unit_price_usd === 'number' ? body.unit_price_usd : null,
      channel: typeof body.channel === 'string' ? body.channel : 'own',
      received_at: receivedAt,
      expires_at: expiresAt.toISOString(),
      is_current: true,
      confirmed_by: actor,
      confirmed_at: new Date().toISOString(),
      is_test: body.is_test === true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // audit_log (gpu_audit_logs는 service_role 전용 — adminClient 사용)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any)
    .from('gpu_audit_logs')
    .insert({
      actor,
      action_type: 'availability_registered',
      product_id: productId,
      detail: {
        status,
        resp_qty: body.resp_qty,
        supplier_id: supplierId,
        is_test: body.is_test === true,
      },
    })

  return NextResponse.json({ record: newRecord })
}
