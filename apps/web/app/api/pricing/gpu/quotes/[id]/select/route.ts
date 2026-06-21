import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { getGpuCatalog } from '@/lib/gpu/pricing'

// 같은 모델(model_name+tier)의 모든 구성 product_id (전략가 추종·모델범위 채택 대상)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function modelSiblingIds(db: any, productId: string): Promise<string[]> {
  const { data: self } = await db
    .from('gpu_products').select('model_name, tier').eq('id', productId).is('deleted_at', null).single()
  if (!self) return [productId]
  const { data: sibs } = await db
    .from('gpu_products').select('id')
    .eq('model_name', self.model_name).eq('tier', self.tier).is('deleted_at', null)
  return sibs?.length ? sibs.map((s: { id: string }) => s.id) : [productId]
}

// POST /api/pricing/gpu/quotes/[id]/select
//  body: { selected: boolean, scope?: 'config' | 'model' }
//  - selected=true  → 채택(기준 공급가). scope='config'(기본)=이 구성만 / scope='model'=모델 4개 구성 전부(파생 전파 상속)
//  - selected=false → 이 견적 채택 해제
//  채택은 cost 견적만 가능(자사/경쟁 'list' 공시가는 기준 불가).
//  scope='model'이면 같은 모델(model_name+tier)의 모든 구성 채택을 먼저 해제해 단일 기준 보장.
//  ★ 공급가 변경 시 판매가(전략가)를 원가×마진 추천가로 자동 추종(역마진 방지) — 영향 product 전체.
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

  // 대상 견적 확인 (selection_scope 포함 — 해제 시 모델/구성 영향범위 판정)
  const { data: quote, error: qErr } = await db
    .from('supply_quotes')
    .select('id, product_id, price_type, supplier_id, selection_scope')
    .eq('id', id)
    .single()
  if (qErr || !quote) return NextResponse.json({ error: '견적을 찾을 수 없습니다' }, { status: 404 })
  if (selected && quote.price_type === 'list') {
    return NextResponse.json({ error: '공시 판매가(참고)는 기준 공급가로 채택할 수 없습니다' }, { status: 400 })
  }

  // 공급가 변경의 영향 product 집합: model 범위면 모델 형제 전체, config면 해당 구성만.
  //  - 채택(select): 새 scope 기준 / 해제(deselect): 기존 selection_scope 기준
  const effScope = selected ? scope : quote.selection_scope
  const affectedProductIds: string[] = effScope === 'model'
    ? await modelSiblingIds(db, quote.product_id)
    : [quote.product_id]

  if (selected) {
    // 기존 채택 모두 해제 (partial unique index 충돌 방지 + 모델 단일 기준 보장)
    const { error: clearErr } = await db
      .from('supply_quotes')
      .update({ is_selected: false })
      .in('product_id', affectedProductIds)
      .eq('is_selected', true)
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })
  }

  const { error: setErr } = await db
    .from('supply_quotes')
    .update({ is_selected: selected, selection_scope: selected ? scope : 'config' })
    .eq('id', id)
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })

  // 전략가(판매가) 추종 — 공급가 채택/해제로 바뀐 영향 product의 추천가(원가×마진)로 갱신.
  //   (사용자 정책 A: 공급가 변경 시 판매가는 추천가를 따른다. 역마진 방지.)
  //   ★ 원가기반 basis(selected/auto)에서만 추종. list(gcube 공시가)·none은 제외 —
  //     외부 공시가를 우리 전략가 SSOT로 흡수하지 않기 위함(DC-REV H1).
  //   지정 자체 성공을 막지 않도록 추종 실패는 격리(부분 실패 건수만 기록).
  let followUpdated = 0
  try {
    const catalog = await getGpuCatalog(db)
    const affected = new Set(affectedProductIds)
    const targets = catalog.products.filter(
      (p) => affected.has(p.id) && (p.basis === 'selected' || p.basis === 'auto') && p.sell_price_krw != null
    )
    const results = await Promise.allSettled(
      targets.map((p) => db.from('gpu_products').update({ strategic_price_krw: p.sell_price_krw }).eq('id', p.id))
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    followUpdated = results.filter((r) => r.status === 'fulfilled' && !(r.value as any)?.error).length
  } catch (e) {
    console.error('[pricing/select] 전략가 추종 실패', e)
  }

  await db.from('gpu_audit_logs').insert({
    actor,
    action_type: selected ? 'quote_selected' : 'quote_deselected',
    detail: { quote_id: id, product_id: quote.product_id, supplier_id: quote.supplier_id, scope: effScope, strategic_followed: followUpdated },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, selected, scope, strategic_followed: followUpdated })
}
