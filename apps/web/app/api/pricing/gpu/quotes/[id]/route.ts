import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { assignSupplierToQuote } from '@/lib/gpu/repository'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// PATCH /api/pricing/gpu/quotes/[id]
//  - { supplier_id | supplier_name } → 공급사 지정 (docs 01 §4)
//  - 그 외 편집 필드 → 견적 내용 수정 (단가·장수·기간·최소수량·만료·원본값)
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

  const supabase = await createClient()
  const adminClient = createAdminClient()
  const actor = auth.user.email ?? auth.user.id

  // 공급사 지정 모드
  if ('supplier_id' in body || 'supplier_name' in body) {
    const result = await assignSupplierToQuote(supabase, adminClient, id, {
      supplierId: typeof body.supplier_id === 'string' ? body.supplier_id : null,
      supplierName: typeof body.supplier_name === 'string' ? body.supplier_name : null,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any).from('gpu_audit_logs').insert({
      actor, action_type: 'quote_supplier_assigned', detail: { quote_id: id, supplier_id: result.supplier_id },
    })
    return NextResponse.json({ ok: true, supplier_id: result.supplier_id })
  }

  // 견적 내용 수정 모드
  const patch: Record<string, unknown> = {}
  const num = (v: unknown) => (typeof v === 'number' && !isNaN(v) ? v : undefined)
  const strOrNull = (v: unknown) => (typeof v === 'string' ? (v.trim() || null) : undefined)

  const price = num(body.unit_price_usd)
  if (price !== undefined) {
    if (price <= 0) return NextResponse.json({ error: '단가는 0보다 커야 합니다' }, { status: 400 })
    patch.unit_price_usd = price
  }
  const gc = num(body.gpu_count)
  if (gc !== undefined) {
    if (gc < 1) return NextResponse.json({ error: 'GPU 장수는 1 이상이어야 합니다' }, { status: 400 })
    patch.gpu_count = Math.round(gc)
  }
  const op = num(body.original_price)
  if (op !== undefined) patch.original_price = op
  const tm = num(body.term_months)
  if (tm !== undefined) patch.term_months = Math.round(tm)
  for (const k of ['term', 'min_qty', 'valid_until', 'original_unit', 'original_currency'] as const) {
    const v = strOrNull(body[k])
    if (v !== undefined) patch[k] = v
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '수정할 내용이 없습니다' }, { status: 400 })
  }

  // supply_quotes UPDATE는 service_role/auth 모두 가능하나 트리거 우회 일관 위해 adminClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient as any)
    .from('supply_quotes').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from('gpu_audit_logs').insert({
    actor, action_type: 'quote_edited', product_id: data?.product_id ?? null,
    detail: { quote_id: id, patch },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, quote: data })
}

// DELETE /api/pricing/gpu/quotes/[id] — 견적 삭제
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient as any).from('supply_quotes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from('gpu_audit_logs').insert({
    actor: auth.user.email ?? auth.user.id, action_type: 'quote_deleted', detail: { quote_id: id },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}
