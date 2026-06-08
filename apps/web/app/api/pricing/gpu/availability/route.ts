import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { recordAvailability } from '@/lib/gpu/repository'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

// DELETE /api/pricing/gpu/availability?product_id=&supplier_id= — 해당 공급사 재고응답 소프트삭제
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const sp = new URL(req.url).searchParams
  const product_id = sp.get('product_id'), supplier_id = sp.get('supplier_id')
  if (!product_id || !supplier_id) return NextResponse.json({ error: 'product_id·supplier_id 필요' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { error } = await db
    .from('availability_responses')
    .update({ deleted_at: new Date().toISOString(), is_current: false })
    .eq('product_id', product_id)
    .eq('supplier_id', supplier_id)
    .is('deleted_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'availability_deleted',
    productId: product_id,
    detail: { supplier_id, by: 'product_supplier' },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}

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

  const actor = user.email ?? user.id
  const supplierId = typeof body.supplier_id === 'string' ? body.supplier_id : null

  // L1 단일 쓰기 서비스 경유 (이전 current 비활성화 + 감사로그 + L4 캐시 무효화)
  const result = await recordAvailability(supabase, adminClient, {
    productId,
    supplierId,
    status,
    respQty: typeof body.resp_qty === 'number' ? body.resp_qty : null,
    isTotalCapacity: body.is_total_capacity === true,
    unitPriceUsd: typeof body.unit_price_usd === 'number' ? body.unit_price_usd : null,
    actor,
    isTest: body.is_test === true,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ record: result.record })
}
