import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// POST /api/pricing/gpu/quotes/[id]/select
//  body: { selected: boolean, scope?: 'config' | 'model' }
//  - selected=true  → 채택(기준 공급가). scope='config'(기본)=이 구성만 / scope='model'=모델 4개 구성 전부(파생 전파 상속)
//  - selected=false → 이 견적 채택 해제
//  채택은 cost 견적만 가능(자사/경쟁 'list' 공시가는 기준 불가).
//  scope='model'이면 같은 모델(model_name+tier)의 모든 구성 채택을 먼저 해제해 단일 기준 보장.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params

  let body: { selected?: boolean; scope?: 'config' | 'model' }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }
  const selected = body.selected !== false // 기본 true
  const scope: 'config' | 'model' = body.scope === 'model' ? 'model' : 'config'

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
    // 채택 대상 product_id 집합 결정: config=이 구성만 / model=같은 모델 전 구성
    let clearProductIds: string[] = [quote.product_id]
    if (scope === 'model') {
      const { data: self } = await db
        .from('gpu_products').select('model_name, tier').eq('id', quote.product_id).single()
      if (self) {
        const { data: sibs } = await db
          .from('gpu_products').select('id')
          .eq('model_name', self.model_name).eq('tier', self.tier).is('deleted_at', null)
        if (sibs?.length) clearProductIds = sibs.map((s: { id: string }) => s.id)
      }
    }
    // 기존 채택 모두 해제 (partial unique index 충돌 방지 + 모델 단일 기준 보장)
    const { error: clearErr } = await db
      .from('supply_quotes')
      .update({ is_selected: false })
      .in('product_id', clearProductIds)
      .eq('is_selected', true)
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })
  }

  const { error: setErr } = await db
    .from('supply_quotes')
    .update({ is_selected: selected, selection_scope: selected ? scope : 'config' })
    .eq('id', id)
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })

  await db.from('gpu_audit_logs').insert({
    actor,
    action_type: selected ? 'quote_selected' : 'quote_deselected',
    detail: { quote_id: id, product_id: quote.product_id, supplier_id: quote.supplier_id, scope },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, selected, scope })
}
