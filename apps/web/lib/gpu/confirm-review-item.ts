// 검토 항목 확정 SSOT — 단건(review/[id]) · 일괄(review/bulk) 양쪽이 동일 로직을 호출.
// (재사용·단일구현 정책: confirm 로직을 라우트마다 복붙하지 않는다.)
// 클라이언트는 라우트가 생성해 주입. NextResponse 대신 구조화 결과를 반환한다.

import type { createClient, createAdminClient } from '@/lib/supabase/server'
import { parseGpuCount, toPerGpuPrice } from '@/lib/gpu/parse-quantity'
import { resolveConfirmUnitPrice } from '@/lib/gpu/price-breakdown'
import { parseBilling } from '@/lib/gpu/billing'
import { resolveProductId, heldReasonMessage } from '@/lib/gpu/resolve-product'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { routeIntakeExtras } from '@/lib/gpu/intake-routing'
import { roundUpToStandard, isStandardConfig } from '@/lib/gpu/config-ladder'
import { saveCompetitorPrices, type CompetitorPriceItem } from '@/lib/gpu/competitor-import'
import { saveOwnTargetAsStrategicPrice } from '@/lib/gpu/own-target-import'
import { recordGpuAudit } from '@/lib/gpu/audit'

type UserClient = Awaited<ReturnType<typeof createClient>>
type AdminClient = ReturnType<typeof createAdminClient>

export interface ReviewItemRow {
  id: string
  target?: string | null
  current_extracted?: Record<string, unknown> | null
  supplier_hint?: string | null
  channel?: string | null
  overall_confidence?: number | null
  is_test?: boolean | null
  created_at?: string | null
  evidence_drive_file_id?: string | null
  source_input_id?: string | null
  [k: string]: unknown
}

export interface ConfirmOptions {
  overrideExtracted?: Record<string, unknown>
  supplierId?: string | null
  confirmedItems?: unknown[]
  /** 일괄 확정 경로 — 사람 직접확인 없이 일괄 동의로 들어온 건(감사 정직성) */
  bulk?: boolean
  autoAcceptedLowConf?: string[]
}

export interface ConfirmResult {
  ok: boolean
  status: number
  error?: string
  stock?: { ok: boolean; msg: string }
  strategic?: { product_id: string | null; strategic_price_krw: number | null; msg: string }
  productId?: string | null
}

/**
 * 검토 항목(이미 fetch된 pending 행)을 확정. own_target/competitor/supplier 분기 처리.
 * 호출 전 라우트가 item.status === 'pending' 보장. revalidateGpu()는 내부에서 수행.
 */
export async function confirmReviewItem(
  supabase: UserClient,
  adminClient: AdminClient,
  item: ReviewItemRow,
  actorName: string,
  opts: ConfirmOptions = {},
): Promise<ConfirmResult> {
  const now = new Date().toISOString()
  const id = item.id
  const confirmedItems = Array.isArray(opts.confirmedItems) ? opts.confirmedItems : []
  const isBulk = opts.bulk === true
  const autoAcceptedLowConf = isBulk && Array.isArray(opts.autoAcceptedLowConf) ? opts.autoAcceptedLowConf : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = adminClient as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // own_target(우리 목표/판매가) — 전략가(gpu_products.strategic_price_krw)로 반영(SSOT 모듈).
  if (item.target === 'own_target') {
    const ex = (item.current_extracted ?? {}) as Record<string, unknown>
    const merged = { ...ex, ...(opts.overrideExtracted ?? {}) }
    const { data: fx } = await admin
      .from('fx_rates').select('usd_krw').order('rate_date', { ascending: false }).limit(1).single()
    const fxN = typeof fx?.usd_krw === 'number' ? fx.usd_krw : 0
    const krwPerUsd = fxN >= 800 && fxN <= 3000 ? fxN : 1500
    const result = await saveOwnTargetAsStrategicPrice(
      adminClient, merged, actorName, krwPerUsd,
      (detail, productId) => recordGpuAudit(adminClient, { actor: actorName, actionType: 'strategic_price_set', productId, detail }),
      revalidateGpu,
    )
    if (!result.ok) return { ok: false, status: 422, error: result.reason ?? '전략가 반영 실패' }
    await admin.from('review_items').update({
      status: 'confirmed', confirmed_by: actorName, confirmed_at: now, confirmed_items: confirmedItems,
    }).eq('id', id)
    await admin.from('gpu_audit_logs').insert({
      actor: actorName, action_type: 'review_finalized',
      detail: { review_item_id: id, target: 'own_target', product_id: result.product_id, strategic_price_krw: result.strategic_price_krw, via: isBulk ? 'bulk' : 'single', is_test: item.is_test === true },
    }).then(undefined, () => {})
    return { ok: true, status: 200, strategic: { product_id: result.product_id ?? null, strategic_price_krw: result.strategic_price_krw ?? null, msg: '전략가 반영됨' }, productId: result.product_id ?? null }
  }

  // competitor(경쟁사 카탈로그) — competitors+market_prices로 반영.
  if (item.target === 'competitor') {
    const ex = (item.current_extracted ?? {}) as Record<string, unknown>
    const merged = { ...ex, ...(opts.overrideExtracted ?? {}) }
    const compItem: CompetitorPriceItem = {
      competitor_name: typeof merged.competitor_name === 'string' ? merged.competitor_name : (item.supplier_hint ?? ''),
      model_name: typeof merged.model_name === 'string' ? merged.model_name : '',
      memory: typeof merged.memory === 'string' ? merged.memory : undefined,
      price_usd: typeof merged.price_usd === 'number' ? merged.price_usd : Number(merged.price_usd),
      pricing_model: typeof merged.pricing_model === 'string' ? merged.pricing_model : 'on_demand',
    }
    if (!compItem.competitor_name || !compItem.model_name || !Number.isFinite(compItem.price_usd) || compItem.price_usd <= 0) {
      return { ok: false, status: 422, error: '경쟁사·모델·가격을 특정할 수 없어 확정할 수 없습니다.' }
    }
    const { saved, held } = await saveCompetitorPrices(adminClient, [compItem])
    if (saved.length === 0) {
      // 깡통 자동생성 금지 — 매칭 실패는 사유와 함께 보류(확정 차단)
      const reason = held[0]?.reason
      const msg = reason ? heldReasonMessage(reason, compItem.model_name, 1) : '경쟁사 시장가 반영에 실패했습니다.'
      return { ok: false, status: 422, error: msg }
    }
    await admin.from('review_items').update({
      status: 'confirmed', confirmed_by: actorName, confirmed_at: now, confirmed_items: confirmedItems,
    }).eq('id', id)
    await admin.from('gpu_audit_logs').insert({
      actor: actorName, action_type: 'review_finalized',
      detail: { review_item_id: id, target: 'competitor', saved, via: isBulk ? 'bulk' : 'single', is_test: item.is_test === true },
    }).then(undefined, () => {})
    revalidateGpu()
    return { ok: true, status: 200, stock: { ok: true, msg: '경쟁사 시장가 반영됨' } }
  }

  // supplier — supply_quotes에 적재
  const extracted = (item.current_extracted ?? {}) as Record<string, unknown>
  const merged = { ...extracted, ...(opts.overrideExtracted ?? {}) }

  const rawUnitPrice = typeof merged.unit_price_usd === 'number' ? merged.unit_price_usd : null
  if (!rawUnitPrice) return { ok: false, status: 400, error: '확정할 단가(unit_price_usd)가 없습니다' }

  const originalUnit = typeof merged.original_unit === 'string' ? merged.original_unit : null
  const qtyHint = [merged.model_name, originalUnit, merged.min_qty, merged.term]
    .filter((v) => typeof v === 'string').join(' ')
  const parsedGpuCount = parseGpuCount(qtyHint, typeof merged.gpu_count === 'number' ? merged.gpu_count : 1)
  const gpuCount = roundUpToStandard(parsedGpuCount)
  const fallbackPerGpu = toPerGpuPrice(rawUnitPrice, gpuCount, originalUnit)
  // 환산 정합성 교정 — 주입 매매기준율로 SSOT 재계산(AI 하드코딩 환율 버그 교정). 폴백으로 회귀 0.
  const { data: confFx } = await admin
    .from('fx_rates').select('usd_krw').order('rate_date', { ascending: false }).limit(1).single()
  const confFxN = typeof confFx?.usd_krw === 'number' ? confFx.usd_krw : 0
  const confirmKrwPerUsd = confFxN >= 800 && confFxN <= 3000 ? confFxN : 0
  const billing = parseBilling(merged)
  const confirmPrice = resolveConfirmUnitPrice({
    aiUnitPriceUsd: rawUnitPrice,
    originalPrice: typeof merged.original_price === 'number' ? merged.original_price : null,
    originalCurrency: typeof merged.original_currency === 'string' ? merged.original_currency : null,
    originalUnit, gpuCount, krwPerUsd: confirmKrwPerUsd, fallbackPerGpu,
  })
  const unitPriceUsd = confirmPrice.value

  // product_id 찾기 — resolveProductId SSOT(읽기 전용). 매칭은 캐노니컬 모델명+장수, memory는 변형 구분용.
  //   매칭 실패 시 깡통 자동생성 금지 → 보류(사유 반환). 신규 모델은 스펙관리에서 등록(SSOT 단일 통제).
  const productAutoCreated = false
  let productId: string | null = null
  if (typeof merged.model_name === 'string' && merged.model_name) {
    const resolved = await resolveProductId(db, {
      modelName: merged.model_name,
      gpuCount,
      memory: typeof merged.memory === 'string' ? merged.memory : null,
    })
    if ('held' in resolved) {
      return { ok: false, status: 422, error: heldReasonMessage(resolved.reason, merged.model_name, gpuCount) }
    }
    productId = resolved.productId
  }

  // supplier_id 찾기 — 사용자 선택 우선, 없으면 이름으로 find-or-create
  let supplierId: string | null = typeof opts.supplierId === 'string' ? opts.supplierId : null
  const supplierName = (typeof merged.supplier === 'string' && merged.supplier.trim())
    ? merged.supplier.trim()
    : (typeof item.supplier_hint === 'string' && item.supplier_hint.trim() ? item.supplier_hint.trim() : null)
  if (!supplierId && supplierName) {
    const { data: existing } = await db.from('suppliers').select('id').ilike('name', supplierName).limit(1)
    if (existing?.[0]?.id) {
      supplierId = existing[0].id
    } else {
      const { data: newSup } = await admin.from('suppliers').insert({ name: supplierName }).select('id').single()
      supplierId = newSup?.id ?? null
    }
  }

  // 필수 불변식 — 상품·공급사 특정 실패 시 확정 차단
  if (!productId) {
    return { ok: false, status: 422, error: '상품(GPU 모델)을 특정할 수 없어 확정할 수 없습니다. 모델명을 보정한 뒤 다시 확정하세요.' }
  }
  if (!supplierId) {
    return { ok: false, status: 422, error: '공급사를 특정할 수 없어 확정할 수 없습니다. 검토 화면에서 공급사를 지정한 뒤 확정하세요.' }
  }

  // 멱등: 동일 (상품·공급사·약정) 기존 confirmed → superseded 이력화
  const termMonths = typeof merged.term_months === 'number' ? merged.term_months : null
  let supQ = admin.from('supply_quotes').update({ status: 'superseded' })
    .eq('product_id', productId).eq('supplier_id', supplierId).eq('status', 'confirmed')
  supQ = termMonths === null ? supQ.is('term_months', null) : supQ.eq('term_months', termMonths)
  await supQ

  const { error: quoteError } = await admin.from('supply_quotes').insert({
    product_id: productId,
    supplier_id: supplierId,
    unit_price_usd: unitPriceUsd,
    gpu_count: gpuCount,
    original_currency: typeof merged.original_currency === 'string' ? merged.original_currency : null,
    original_price: typeof merged.original_price === 'number' ? merged.original_price : null,
    original_unit: originalUnit,
    setup_fee_krw: billing.setupFeeKrw,
    monthly_price_krw: billing.monthlyPriceKrw,
    billing_model: billing.billingModel,
    term: typeof merged.term === 'string' ? merged.term : null,
    term_months: termMonths,
    min_qty: typeof merged.min_qty === 'string' ? merged.min_qty : null,
    valid_until: typeof merged.valid_until === 'string' ? merged.valid_until : null,
    source_format: item.channel ?? 'own',
    evidence_drive_file_id: typeof item.evidence_drive_file_id === 'string' ? item.evidence_drive_file_id
      : (typeof item.source_input_id === 'string' ? item.source_input_id : null),
    source_market_price_id: typeof merged.source_market_price_id === 'string' ? merged.source_market_price_id : null,
    ai_confidence: item.overall_confidence,
    status: 'confirmed',
    received_at: item.created_at,
    registered_by: actorName,
    confirmed_by: actorName,
    confirmed_at: now,
  })
  if (quoteError) return { ok: false, status: 500, error: quoteError.message }

  // 부가 데이터(재고 등) 연계 — 부분커밋(실패가 가격 확정을 되돌리지 않음)
  let routeOutcomes: Awaited<ReturnType<typeof routeIntakeExtras>> = []
  try {
    routeOutcomes = await routeIntakeExtras(
      { db: adminClient, adminDb: adminClient, productId, supplierId, actor: actorName, isTest: item.is_test === true },
      merged as Record<string, unknown>,
    )
  } catch (e) {
    routeOutcomes = [{ target: 'availability_responses', status: 'error', reason: e instanceof Error ? e.message : '재고 연계 예외' }]
  }

  await admin.from('review_items').update({
    status: 'confirmed', confirmed_by: actorName, confirmed_at: now, confirmed_items: confirmedItems,
  }).eq('id', id)

  await admin.from('gpu_audit_logs').insert({
    actor: actorName,
    action_type: 'review_finalized',
    product_id: productId,
    detail: {
      review_item_id: id,
      unit_price_usd: unitPriceUsd,
      unit_price_recomputed: confirmPrice.recomputed,
      unit_price_recompute_reason: confirmPrice.reason,
      ai_unit_price_usd: rawUnitPrice,
      via: isBulk ? 'bulk' : 'single',
      auto_accepted_low_conf: autoAcceptedLowConf,
      supplier_hint: item.supplier_hint,
      overall_confidence: item.overall_confidence,
      product_auto_created: productAutoCreated,
      route_outcomes: routeOutcomes,
      raw_gpu_count: parsedGpuCount,
      gpu_count_normalized: gpuCount,
      is_nonstandard_source: !isStandardConfig(parsedGpuCount),
    },
  })

  // 유령 ×N 사다리 자동생성 중단(v0.7.240) — 견적 없는 파생 구성행이 중복·전파 오가격(+355%)의 원인이었음.
  // 파생 구성은 표시계층(pricing.ts 1장당 전파)에서 파생. DB엔 실제 견적 있는 구성만 존치(중복 0).

  revalidateGpu()

  const avail = routeOutcomes.find((o) => o.target === 'availability_responses')
  const stock = avail?.status === 'written' ? { ok: true, msg: '재고도 반영됨' }
    : avail?.status === 'error' ? { ok: false, msg: `재고 반영 실패: ${avail.reason ?? '오류'} (가격은 저장됨)` }
    : { ok: true, msg: '재고 정보 없음(가격만 저장)' }

  return { ok: true, status: 200, stock, productId }
}
