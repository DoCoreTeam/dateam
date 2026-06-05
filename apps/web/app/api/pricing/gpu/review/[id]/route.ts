import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { normalizeMemory } from '@/lib/gpu/normalize'
import { parseGpuCount, toPerGpuPrice } from '@/lib/gpu/parse-quantity'
import { inferTier } from '@/lib/gpu/tier-dict'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { routeIntakeExtras } from '@/lib/gpu/intake-routing'

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

  const rawUnitPrice = typeof merged.unit_price_usd === 'number' ? merged.unit_price_usd : null
  if (!rawUnitPrice) {
    return NextResponse.json({ error: '확정할 단가(unit_price_usd)가 없습니다' }, { status: 400 })
  }
  // 수량 파싱: model_name·original_unit·min_qty 등에서 GPU 장수 추출 → 1장당 단가 환산
  const originalUnit = typeof merged.original_unit === 'string' ? merged.original_unit : null
  const qtyHint = [merged.model_name, originalUnit, merged.min_qty, merged.term]
    .filter((v) => typeof v === 'string').join(' ')
  const gpuCount = parseGpuCount(qtyHint, typeof merged.gpu_count === 'number' ? merged.gpu_count : 1)
  // 원본은 보존, unit_price_usd는 1장당으로 정규화 저장
  const unitPriceUsd = toPerGpuPrice(rawUnitPrice, gpuCount, originalUnit)

  // product_id 찾기 — 토큰 매칭 후 없으면 AI 추출 데이터로 자동 생성
  let productId: string | null = null
  let productAutoCreated = false
  if (typeof merged.model_name === 'string' && merged.model_name) {
    const modelName = merged.model_name.trim()
    // tier 판정: 사용자가 명시한 tier override 최우선, 없으면 사전(데이터센터=T1/워크스테이션=T2/소비자=T3).
    // AI의 tier_suggestion은 dict를 덮어쓰지 않음(AI 오판 방지) — 사용자 명시(merged.tier)만 override.
    const tierOverride = typeof merged.tier === 'number' && [1, 2, 3].includes(merged.tier) ? merged.tier : null
    const tier = inferTier(modelName, tierOverride)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    // memory를 먼저 정규화 — 매칭 + 생성 양쪽에서 동일하게 사용
    const memory = normalizeMemory(typeof merged.memory === 'string' ? merged.memory : null)
    // 모델 매칭 — generic 토큰(RTX 등) 단일 매칭 금지. 정규화 완전일치 우선 → 구별 토큰 전체 일치.
    // (버그 교정: "RTX 6000 Ada"가 토큰 "RTX"로 "RTX A6000"에 오매칭되던 문제)
    const GENERIC_TOK = new Set(['rtx', 'nvidia', 'gpu', 'geforce', 'quadro', 'tesla', 'sxm', 'pcie', 'ada', 'super', 'ti'])
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '')
    const distinctiveTokens = (s: string) => s.toLowerCase().replace(/[_\-]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !GENERIC_TOK.has(t))
    const targetNorm = norm(modelName)
    const targetTokens = distinctiveTokens(modelName)
    // 같은 memory 후보 전체를 받아 비교 (memory 없으면 tier로 좁힘)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let candQ = (db as any).from('gpu_products').select('id, model_name, tier')
    if (memory) candQ = candQ.eq('memory', memory)
    else candQ = candQ.eq('tier', tier)
    const { data: cands } = await candQ.limit(300)
    const candList = (cands ?? []) as Array<{ id: string; model_name: string; tier: number }>
    // 1) 정규화 완전일치 (가장 안전)
    let hit = candList.find((c) => norm(c.model_name) === targetNorm)
    // 2) 입력의 구별 토큰을 후보가 "모두" 포함하고, 후보의 구별 토큰도 입력에 모두 포함(양방향) → 동등 모델만
    if (!hit && targetTokens.length > 0) {
      hit = candList.find((c) => {
        const ct = distinctiveTokens(c.model_name)
        if (ct.length === 0) return false
        return targetTokens.every((t) => ct.includes(t)) && ct.every((t) => targetTokens.includes(t))
      })
    }
    if (hit?.id) productId = hit.id

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

  // supplier_id 찾기 — 사용자가 직접 선택한 경우 우선, 없으면 이름으로 find-or-create
  let supplierId: string | null = typeof body.supplier_id === 'string' ? body.supplier_id : null
  // merged.supplier 우선, 없으면 review_item의 supplier_hint(AI 추출 공급사명) 폴백
  const supplierName = (typeof merged.supplier === 'string' && merged.supplier.trim())
    ? merged.supplier.trim()
    : (typeof item.supplier_hint === 'string' && item.supplier_hint.trim() ? item.supplier_hint.trim() : null)
  if (!supplierId && supplierName) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from('suppliers')
      .select('id')
      .ilike('name', supplierName)
      .limit(1)
    if (existing?.[0]?.id) {
      supplierId = existing[0].id
    } else {
      // 없으면 신규 공급사 생성 (suppliers 쓰기는 service_role 전용 RLS — adminClient)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newSup } = await (adminClient as any)
        .from('suppliers')
        .insert({ name: supplierName })
        .select('id')
        .single()
      supplierId = newSup?.id ?? null
    }
  }

  // 정합성 정의 (필수 불변식) — 확정 견적은 상품·공급사가 반드시 특정되어야 한다.
  // 못 찾으면 "공급사 미지정/상품 미연결" 불량 데이터가 적재되므로 확정 차단(검토 단계로 되돌림).
  // 같은 규칙을 quotes/[id]/confirm 라우트와 DB 트리거(052)에서도 강제 — 3중 방어.
  if (!productId) {
    return NextResponse.json({
      error: '상품(GPU 모델)을 특정할 수 없어 확정할 수 없습니다. 모델명을 보정한 뒤 다시 확정하세요.',
    }, { status: 422 })
  }
  if (!supplierId) {
    return NextResponse.json({
      error: '공급사를 특정할 수 없어 확정할 수 없습니다. 검토 화면에서 공급사를 지정한 뒤 확정하세요.',
    }, { status: 422 })
  }

  // 멱등: 동일 (상품·공급사·계약기간) 기존 confirmed 견적이 있으면 superseded로 이력화
  // (공급사가 같은 견적을 다시 넣어도 활성은 1건만 유지 + 이전 가격 이력 보존)
  const termMonths = typeof merged.term_months === 'number' ? merged.term_months : null
  if (productId && supplierId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let supQ = (adminClient as any)
      .from('supply_quotes')
      .update({ status: 'superseded' })
      .eq('product_id', productId)
      .eq('supplier_id', supplierId)
      .eq('status', 'confirmed')
    supQ = termMonths === null ? supQ.is('term_months', null) : supQ.eq('term_months', termMonths)
    await supQ
  }

  // supply_quotes는 service_role 전용 RLS — adminClient 사용
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: quoteError } = await (adminClient as any)
    .from('supply_quotes')
    .insert({
      product_id: productId,
      supplier_id: supplierId,
      unit_price_usd: unitPriceUsd,
      gpu_count: gpuCount,
      original_currency: typeof merged.original_currency === 'string' ? merged.original_currency : null,
      original_price: typeof merged.original_price === 'number' ? merged.original_price : null,
      original_unit: originalUnit,
      term: typeof merged.term === 'string' ? merged.term : null,
      term_months: termMonths,
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

  // 축2/3: 추출된 재고(quantity) 등 부가 데이터를 올바른 테이블로 유기적 연계(단일 라우터 재사용).
  // 부분커밋 — 재고 연계 실패가 가격 확정을 되돌리지 않음. recordAvailability가 멱등(product×supplier 1건 current).
  let routeOutcomes: Awaited<ReturnType<typeof routeIntakeExtras>> = []
  if (productId && supplierId) {
    try {
      routeOutcomes = await routeIntakeExtras(
        { db: adminClient, adminDb: adminClient, productId, supplierId, actor: actorName, isTest: item.is_test === true },
        merged as Record<string, unknown>,
      )
    } catch (e) {
      routeOutcomes = [{ target: 'availability_responses', status: 'error', reason: e instanceof Error ? e.message : '재고 연계 예외' }]
    }
  }

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
        route_outcomes: routeOutcomes,
      },
    })

  // L4 — 견적 확정 시 4개 메뉴 캐시 원자 무효화
  revalidateGpu()

  // M5(DC-REV): 재고 연계 결과를 응답에 노출 — 부분커밋(가격 확정·재고 실패)을 사용자가 인지하도록.
  const avail = routeOutcomes.find((o) => o.target === 'availability_responses')
  const stock = avail?.status === 'written' ? { ok: true, msg: '재고도 반영됨' }
    : avail?.status === 'error' ? { ok: false, msg: `재고 반영 실패: ${avail.reason ?? '오류'} (가격은 저장됨)` }
    : { ok: true, msg: '재고 정보 없음(가격만 저장)' }

  return NextResponse.json({ ok: true, stock })
}
