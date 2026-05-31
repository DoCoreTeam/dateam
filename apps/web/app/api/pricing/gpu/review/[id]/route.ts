import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { normalizeMemory } from '@/lib/gpu/normalize'

// POST /api/pricing/gpu/review/[id] — 확정 또는 반려
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const supabase = await createClient()
  const user = auth.user

  const { id } = await params

  let body: {
    action?: unknown
    confirmed_items?: unknown
    rejected_reason?: unknown
    override_extracted?: unknown
    supplier_id?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  if (!['confirm', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action은 confirm 또는 reject' }, { status: 400 })
  }

  // 현재 review_item 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item, error: fetchError } = await (supabase as any)
    .from('review_items')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !item) return NextResponse.json({ error: '검토 항목을 찾을 수 없습니다' }, { status: 404 })
  if (item.status !== 'pending') return NextResponse.json({ error: '이미 처리된 항목입니다' }, { status: 409 })

  const now = new Date().toISOString()
  const actorName = user.email ?? user.id
  const adminClient = createAdminClient()

  if (action === 'reject') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('review_items')
      .update({
        status: 'rejected',
        confirmed_by: actorName,
        confirmed_at: now,
        rejected_reason: typeof body.rejected_reason === 'string' ? body.rejected_reason : null,
      })
      .eq('id', id)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any)
      .from('gpu_audit_logs')
      .insert({
        actor: actorName,
        action_type: 'review_rejected',
        detail: { review_item_id: id, reason: body.rejected_reason ?? null },
      })

    return NextResponse.json({ ok: true })
  }

  // confirm — supply_quotes에 적재
  const extracted = (item.current_extracted ?? {}) as Record<string, unknown>
  const overrideExtracted = (body.override_extracted ?? {}) as Record<string, unknown>
  const merged = { ...extracted, ...overrideExtracted }

  const unitPriceUsd = typeof merged.unit_price_usd === 'number' ? merged.unit_price_usd : null
  if (!unitPriceUsd) {
    return NextResponse.json({ error: '확정할 단가(unit_price_usd)가 없습니다' }, { status: 400 })
  }

  // product_id 찾기 — 토큰 매칭 후 없으면 AI 추출 데이터로 자동 생성
  let productId: string | null = null
  let productAutoCreated = false
  if (typeof merged.model_name === 'string' && merged.model_name) {
    const modelName = merged.model_name.trim()
    const tier = typeof merged.tier_suggestion === 'number' ? merged.tier_suggestion : 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    // memory를 먼저 정규화 — 매칭 + 생성 양쪽에서 동일하게 사용
    const memory = normalizeMemory(typeof merged.memory === 'string' ? merged.memory : null)
    const tokens = modelName.split(/\s+/).filter((t: string) => t.length >= 2)
    for (const token of tokens) {
      // memory가 있으면 model_name+memory 조합으로 정확 매칭 → 동일 칩명 다른 용량 오매칭 방지
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (db as any)
        .from('gpu_products')
        .select('id')
        .ilike('model_name', `%${token}%`)
        .eq('tier', tier)
      if (memory) q = q.eq('memory', memory)
      const { data: products } = await q.limit(1)
      if (products?.[0]?.id) { productId = products[0].id; break }
    }

    // 매칭 실패 → AI 추출 데이터로 신규 product 자동 생성
    if (!productId) {
      const series = modelName.split(/\s+/)[0] // "H100 SXM" → "H100", "B300" → "B300"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newProduct } = await (adminClient as any)
        .from('gpu_products')
        .insert({ model_name: modelName, memory, tier, series, pricing_mode: 'quote' })
        .select('id')
        .single()
      if (newProduct?.id) {
        productId = newProduct.id
        productAutoCreated = true
      }
    }
  }

  // supplier_id 찾기 — 사용자가 직접 선택한 경우 우선 사용
  let supplierId: string | null = typeof body.supplier_id === 'string' ? body.supplier_id : null
  if (!supplierId && typeof merged.supplier === 'string' && merged.supplier) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: suppliers } = await (supabase as any)
      .from('suppliers')
      .select('id')
      .ilike('name', `%${merged.supplier}%`)
      .limit(1)
    supplierId = suppliers?.[0]?.id ?? null
  }

  // supply_quotes는 service_role 전용 RLS — adminClient 사용
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: quoteError } = await (adminClient as any)
    .from('supply_quotes')
    .insert({
      product_id: productId,
      supplier_id: supplierId,
      unit_price_usd: unitPriceUsd,
      original_currency: typeof merged.original_currency === 'string' ? merged.original_currency : null,
      original_price: typeof merged.original_price === 'number' ? merged.original_price : null,
      original_unit: typeof merged.original_unit === 'string' ? merged.original_unit : null,
      term: typeof merged.term === 'string' ? merged.term : null,
      term_months: typeof merged.term_months === 'number' ? merged.term_months : null,
      min_qty: typeof merged.min_qty === 'string' ? merged.min_qty : null,
      valid_until: typeof merged.valid_until === 'string' ? merged.valid_until : null,
      source_format: item.channel ?? 'own',
      ai_confidence: item.overall_confidence,
      status: 'confirmed',
      received_at: item.created_at,
      registered_by: actorName,
      confirmed_by: actorName,
      confirmed_at: now,
    })

  if (quoteError) return NextResponse.json({ error: quoteError.message }, { status: 500 })

  // review_item 상태 업데이트
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('review_items')
    .update({
      status: 'confirmed',
      confirmed_by: actorName,
      confirmed_at: now,
      confirmed_items: Array.isArray(body.confirmed_items) ? body.confirmed_items : [],
    })
    .eq('id', id)

  // audit_log (gpu_audit_logs는 service_role 전용 — adminClient 사용)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any)
    .from('gpu_audit_logs')
    .insert({
      actor: actorName,
      action_type: 'review_finalized',
      product_id: productId,
      detail: {
        review_item_id: id,
        unit_price_usd: unitPriceUsd,
        supplier_hint: item.supplier_hint,
        overall_confidence: item.overall_confidence,
        product_auto_created: productAutoCreated,
      },
    })

  return NextResponse.json({ ok: true })
}
