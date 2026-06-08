import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { assignSupplierToQuote } from '@/lib/gpu/repository'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { countImpact } from '@/lib/gpu/impact'

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
    await recordGpuAudit(adminClient as any, {
      actor, actionType: 'quote_supplier_assigned',
      detail: { quote_id: id, supplier_id: result.supplier_id },
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient as any)
    .from('supply_quotes').update(patch).eq('id', id).is('deleted_at', null).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '견적을 찾을 수 없습니다' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recordGpuAudit(adminClient as any, {
    actor, actionType: 'quote_edited',
    productId: data?.product_id ?? null,
    detail: { quote_id: id, patch },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, quote: data })
}

// DELETE /api/pricing/gpu/quotes/[id] — 견적 소프트삭제
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = adminClient as any

  const impact = await countImpact(adminDb, 'supply_quote', id)
  // is_selected=1 → 채택 견적 삭제 경고 (force 없으면 차단)
  if ((impact.detail['is_selected'] ?? 0) > 0 && !force) {
    return NextResponse.json({
      error: '채택된 견적입니다. ?force=true를 사용하면 강제 삭제됩니다.',
      impact: impact.detail,
    }, { status: 409 })
  }

  // 소프트삭제: deleted_at 설정
  const { data, error } = await adminDb
    .from('supply_quotes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('product_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordGpuAudit(adminDb, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'quote_deleted',
    productId: data?.product_id ?? null,
    detail: { quote_id: id, force },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}
