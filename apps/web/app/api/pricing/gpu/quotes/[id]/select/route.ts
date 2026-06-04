import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// POST /api/pricing/gpu/quotes/[id]/select
//  body: { selected: boolean }
//  - selected=true  → 같은 상품의 다른 채택 해제 후 이 견적을 채택(기준 공급가)
//  - selected=false → 이 견적 채택 해제
//  채택은 cost 견적만 가능(자사/경쟁 'list' 공시가는 기준 불가).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params

  let body: { selected?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }
  const selected = body.selected !== false // 기본 true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id

  // 대상 견적 확인
  const { data: quote, error: qErr } = await db
    .from('supply_quotes')
    .select('id, product_id, price_type, supplier_id')
    .eq('id', id)
    .single()
  if (qErr || !quote) return NextResponse.json({ error: '견적을 찾을 수 없습니다' }, { status: 404 })
  if (selected && quote.price_type === 'list') {
    return NextResponse.json({ error: '공시 판매가(참고)는 기준 공급가로 채택할 수 없습니다' }, { status: 400 })
  }

  if (selected) {
    // 같은 상품의 기존 채택 모두 해제 (partial unique index 충돌 방지)
    const { error: clearErr } = await db
      .from('supply_quotes')
      .update({ is_selected: false })
      .eq('product_id', quote.product_id)
      .eq('is_selected', true)
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })
  }

  const { error: setErr } = await db
    .from('supply_quotes')
    .update({ is_selected: selected })
    .eq('id', id)
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })

  await db.from('gpu_audit_logs').insert({
    actor,
    action_type: selected ? 'quote_selected' : 'quote_deselected',
    detail: { quote_id: id, product_id: quote.product_id, supplier_id: quote.supplier_id },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, selected })
}
