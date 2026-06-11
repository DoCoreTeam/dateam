// POST /api/pricing/gpu/market/ingest-cost — 경쟁사 시장가 → 원가 인입 (승인형, 자동 트리거 금지)
//
// 흐름:
//   body { market_price_id }
//   → market_prices(price_usd, mapping_id) 조회
//   → competitor_product_mapping(competitor_id, gpu_product_id) 조회
//   → competitors(supplier_id) — 연결 공급사 없으면 400
//   → supply_quotes INSERT (price_type='cost', source_format='market_link', status='confirmed')
//       unit_price_usd = market_price.price_usd 스냅샷(고정)
//
// 정책:
//   - 수동 명시 호출만(자동 인입 금지)
//   - 인입가는 인입 시점 시장가로 고정(스냅샷). 이후 시장가 변동은 자동 반영 안 함.
//   - 중복 가드: 같은 source_market_price_id로 active(deleted_at null) cost 견적이 이미 있으면 409.
//   - 인입된 cost는 buildCatalog(getGpuCatalog)가 confirmed·cost·valid 견적으로 흡수 →
//     effective_unit_price_usd → ×(1+margin) → sell_price 자동 반영(추가 작업 불필요).

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const marketPriceId = body.market_price_id
  if (typeof marketPriceId !== 'string' || !UUID_RE.test(marketPriceId)) {
    return NextResponse.json({ error: 'market_price_id 필수(uuid)' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id

  // 1) market_price 조회 (active만)
  const { data: mp, error: mpErr } = await db
    .from('market_prices')
    .select('id, mapping_id, price_usd')
    .eq('id', marketPriceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (mpErr) {
    console.error('[market/ingest-cost] market_price lookup', mpErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!mp) {
    return NextResponse.json({ error: '시장가를 찾을 수 없습니다' }, { status: 404 })
  }
  const priceUsd = Number(mp.price_usd)
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return NextResponse.json({ error: '시장가가 유효하지 않습니다(양수 아님)' }, { status: 400 })
  }

  // 2) mapping → competitor_id, gpu_product_id
  const { data: mapping, error: mapErr } = await db
    .from('competitor_product_mapping')
    .select('id, competitor_id, gpu_product_id')
    .eq('id', mp.mapping_id)
    .maybeSingle()
  if (mapErr) {
    console.error('[market/ingest-cost] mapping lookup', mapErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!mapping?.gpu_product_id) {
    return NextResponse.json({ error: '시장가에 연결된 제품 매핑이 없습니다' }, { status: 400 })
  }

  // 3) competitor → supplier_id (연결 필수)
  const { data: competitor, error: compErr } = await db
    .from('competitors')
    .select('id, name, supplier_id')
    .eq('id', mapping.competitor_id)
    .maybeSingle()
  if (compErr) {
    console.error('[market/ingest-cost] competitor lookup', compErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!competitor?.supplier_id) {
    return NextResponse.json(
      { error: '공급사 연결 필요 — 이 경쟁사를 먼저 공급사에 연결하세요' },
      { status: 400 },
    )
  }

  // 4) 제품 메타(gpu_count, account 연계용 공급사)
  const { data: product, error: prodErr } = await db
    .from('gpu_products')
    .select('id, gpu_count')
    .eq('id', mapping.gpu_product_id)
    .maybeSingle()
  if (prodErr) {
    console.error('[market/ingest-cost] product lookup', prodErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!product) {
    return NextResponse.json({ error: '대상 GPU 제품을 찾을 수 없습니다' }, { status: 404 })
  }
  const gpuCount = Math.max(1, Number(product.gpu_count) || 1)

  // 5) 중복 인입 가드 — 같은 출처 시장가로 active cost 견적이 이미 존재하면 409
  const { data: existing, error: dupErr } = await db
    .from('supply_quotes')
    .select('id')
    .eq('source_market_price_id', marketPriceId)
    .eq('price_type', 'cost')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (dupErr) {
    console.error('[market/ingest-cost] dup check', dupErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (existing) {
    return NextResponse.json(
      {
        error: '이미 인입된 시장가입니다(스냅샷 정책). 새 시장가 수집 후 다시 인입하세요.',
        existing_quote_id: existing.id,
      },
      { status: 409 },
    )
  }

  // 공급사 account_id 연계(있으면 — 회사=accounts 통합 일관성). 비치명적.
  let accountId: string | null = null
  try {
    const { data: sup } = await db
      .from('suppliers')
      .select('account_id')
      .eq('id', competitor.supplier_id)
      .maybeSingle()
    accountId = sup?.account_id ?? null
  } catch { /* 비치명적 */ }

  // 6) supply_quotes INSERT — cost 스냅샷
  const { data: quote, error: insErr } = await db
    .from('supply_quotes')
    .insert({
      product_id: mapping.gpu_product_id,
      supplier_id: competitor.supplier_id,
      account_id: accountId,
      unit_price_usd: priceUsd,            // 인입 시점 시장가 스냅샷(고정)
      gpu_count: gpuCount,
      price_type: 'cost',
      status: 'confirmed',
      source_format: 'market_link',
      source_market_price_id: marketPriceId,
      source_competitor_id: competitor.id,
      received_at: new Date().toISOString(),
      registered_by: actor,
    })
    .select()
    .single()
  if (insErr) {
    console.error('[market/ingest-cost] insert', insErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor,
    actionType: 'market_cost_ingested',
    productId: mapping.gpu_product_id,
    detail: {
      market_price_id: marketPriceId,
      price_usd: priceUsd,
      competitor_id: competitor.id,
      supplier_id: competitor.supplier_id,
      quote_id: quote.id,
    },
    evidenceRef: marketPriceId,
  })

  revalidateGpu()
  return NextResponse.json({ quote }, { status: 201 })
}
