import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// GET /api/pricing/gpu/suppliers/[id] — 공급사 상세 + 해당 공급사의 모든 견적/상품
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: supplier, error } = await db
    .from('suppliers')
    .select('id, name, location, color, contact, country, website, description, created_at, updated_at')
    .eq('id', id)
    .single()
  if (error || !supplier) return NextResponse.json({ error: '공급사를 찾을 수 없습니다' }, { status: 404 })

  // 이 공급사의 모든 견적 (상품 조인)
  const { data: quotes } = await db
    .from('supply_quotes')
    .select('id, unit_price_usd, gpu_count, status, term, term_months, min_qty, valid_until, received_at, confirmed_at, source_format, gpu_products(id, model_name, memory, tier, gpu_count)')
    .eq('supplier_id', id)
    .order('status')
    .order('unit_price_usd', { ascending: true })

  // 가용량(재고) 응답
  const { data: availability } = await db
    .from('availability_responses')
    .select('id, product_id, status, resp_qty, received_at, is_current, gpu_products(model_name, memory)')
    .eq('supplier_id', id)
    .eq('is_current', true)

  const confirmed = (quotes ?? []).filter((q: { status: string }) => q.status === 'confirmed')
  return NextResponse.json({
    supplier,
    quotes: quotes ?? [],
    availability: availability ?? [],
    stats: {
      total_quotes: (quotes ?? []).length,
      confirmed_quotes: confirmed.length,
      models: new Set(confirmed.map((q: { gpu_products?: { model_name?: string } }) => q.gpu_products?.model_name).filter(Boolean)).size,
    },
  })
}

// PATCH /api/pricing/gpu/suppliers/[id] — 공급사 정보 수정 (CRUD-U)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const str = (v: unknown) => (typeof v === 'string' ? (v.trim() || null) : undefined)
  for (const k of ['name', 'location', 'contact', 'country', 'website', 'description', 'color'] as const) {
    const v = str(body[k])
    if (v !== undefined) patch[k] = v
  }
  if (patch.name === null) return NextResponse.json({ error: '이름은 비울 수 없습니다' }, { status: 400 })

  // suppliers UPDATE는 service_role 전용 RLS → adminClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any)
    .from('suppliers').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateGpu()
  return NextResponse.json({ supplier: data })
}

// DELETE /api/pricing/gpu/suppliers/[id] — 공급사 삭제 (CRUD-D)
// 확정 견적이 있으면 삭제 차단(데이터 정합성 — 견적의 공급사가 사라지면 '공급사 미지정' 재발).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params

  // suppliers DELETE / 견적 조회는 service_role 전용 RLS → adminClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const { count } = await db
    .from('supply_quotes')
    .select('id', { count: 'exact', head: true })
    .eq('supplier_id', id)
    .eq('status', 'confirmed')

  if ((count ?? 0) > 0) {
    return NextResponse.json({
      error: `확정 견적 ${count}건이 연결되어 있어 삭제할 수 없습니다. 견적을 먼저 정리(반려/대체)하세요.`,
    }, { status: 409 })
  }

  const { error } = await db.from('suppliers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}
