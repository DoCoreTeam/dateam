import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { REVIEW_CHANNELS } from '@/lib/gpu/review-channels'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 동기화 변경 판정 임계 — 부동소수 비교용(이보다 작은 차이는 동일값 취급)
const EPS = 1e-6

// POST /api/pricing/gpu/market/sync-cost — 경쟁사 시장가를 공급원가로 동기화(검토 대기 큐 등록)
//   body { competitor_id? }  (없으면 공급사 연결된 전 경쟁사)
//   동작: 연결 경쟁사의 매핑별 최신 시장가를 현재 공급원가(market_link cost)와 비교 →
//     값이 바뀐 항목만 review_items(channel='market_link', status='pending')로 등록.
//     동일값/이미 검토대기 중복은 건너뜀. 승인 시 기존 검토대기 탭에서 확정→공급원가 반영(실견적 우선 규칙 적용).
//   정책: 값 변경 시 무조건 검토 대기(자동 반영 금지). 인입 스냅샷.
export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* body 선택 */ }
  const onlyCompetitorId = typeof body.competitor_id === 'string' && UUID_RE.test(body.competitor_id) ? body.competitor_id : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id

  // 1) 공급사 연결된 경쟁사
  let compQ = db.from('competitors').select('id, name, supplier_id').is('deleted_at', null).not('supplier_id', 'is', null)
  if (onlyCompetitorId) compQ = compQ.eq('id', onlyCompetitorId)
  const { data: comps } = await compQ
  const competitors = (comps ?? []) as { id: string; name: string; supplier_id: string }[]
  if (competitors.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, competitors: 0, message: '공급사로 지정된 경쟁사가 없습니다' })
  }

  // 공급사명
  const supIds = Array.from(new Set(competitors.map((c) => c.supplier_id)))
  const { data: sups } = await db.from('suppliers').select('id, name').in('id', supIds)
  const supNameById = new Map<string, string>((sups ?? []).map((s: { id: string; name: string }) => [s.id, s.name]))

  // 기존 검토대기(market_link) 중복 방지 키 집합
  const { data: pendings } = await db
    .from('review_items')
    .select('supplier_hint, product_hint, current_extracted')
    .eq('status', 'pending')
    .is('deleted_at', null)
    .eq('channel', REVIEW_CHANNELS.MARKET_LINK)
  const pendingKeys = new Set<string>()
  for (const r of pendings ?? []) {
    const row = r as { supplier_hint: string | null; product_hint: string | null; current_extracted: Record<string, unknown> | null }
    const price = Number(row.current_extracted?.price_usd)
    pendingKeys.add(`${row.supplier_hint ?? ''}|${row.product_hint ?? ''}|${Number.isFinite(price) ? price.toFixed(4) : ''}`)
  }

  let created = 0, skipped = 0
  const rows: Record<string, unknown>[] = []

  for (const comp of competitors) {
    const supplierName = supNameById.get(comp.supplier_id) ?? comp.name
    // 매핑 + 모델
    const { data: mappings } = await db
      .from('competitor_product_mapping').select('id, gpu_product_id').eq('competitor_id', comp.id).eq('is_active', true)
    const mapList = (mappings ?? []).filter((m: { gpu_product_id?: string }) => m.gpu_product_id) as { id: string; gpu_product_id: string }[]
    if (mapList.length === 0) continue
    const mappingIds = mapList.map((m) => m.id)
    const productIds = Array.from(new Set(mapList.map((m) => m.gpu_product_id)))

    const { data: products } = await db.from('gpu_products').select('id, model_name, memory, gpu_count').in('id', productIds)
    const prodById = new Map<string, { model_name: string; memory: string | null; gpu_count: number }>()
    for (const p of products ?? []) { const r = p as { id: string; model_name: string; memory: string | null; gpu_count: number }; prodById.set(r.id, r) }

    // 매핑별 최신 시장가
    const { data: prices } = await db
      .from('market_prices').select('mapping_id, price_usd, recorded_at, id')
      .in('mapping_id', mappingIds).is('deleted_at', null)
      .order('recorded_at', { ascending: false }).order('id', { ascending: false })
    const latestByMapping = new Map<string, { price_usd: number; price_id: string }>()
    for (const p of prices ?? []) {
      const r = p as { mapping_id: string; price_usd: number; id: string }
      if (!latestByMapping.has(r.mapping_id)) latestByMapping.set(r.mapping_id, { price_usd: Number(r.price_usd), price_id: r.id })
    }

    // 현재 공급원가(market_link cost) — product+supplier별
    const { data: curCosts } = await db
      .from('supply_quotes').select('product_id, unit_price_usd')
      .eq('supplier_id', comp.supplier_id).eq('status', 'confirmed').eq('price_type', 'cost')
      .eq('source_format', 'market_link').is('deleted_at', null).in('product_id', productIds)
    const curByProduct = new Map<string, number>()
    for (const q of curCosts ?? []) { const r = q as { product_id: string; unit_price_usd: number }; curByProduct.set(r.product_id, Number(r.unit_price_usd)) }

    for (const m of mapList) {
      const latestRow = latestByMapping.get(m.id)
      if (!latestRow) continue
      const latest = latestRow.price_usd
      if (!Number.isFinite(latest) || latest <= 0) continue
      const prod = prodById.get(m.gpu_product_id)
      if (!prod) continue
      const cur = curByProduct.get(m.gpu_product_id)
      // 값 변경 판정: 현재 공급원가 없거나, 차이가 임계 초과면 변경
      const changed = cur == null || Math.abs(cur - latest) > EPS
      if (!changed) { skipped++; continue }
      const productHint = `${prod.model_name} ${prod.memory ?? ''}`.trim()
      const key = `${supplierName}|${productHint}|${latest.toFixed(4)}`
      if (pendingKeys.has(key)) { skipped++; continue }
      pendingKeys.add(key)
      rows.push({
        source_input_id: null,
        source_batch_id: null,
        batch_index: 0,
        product_hint: productHint,
        supplier_hint: supplierName,
        channel: REVIEW_CHANNELS.MARKET_LINK,
        // impact_level: review_items CHECK 값(new_model/price_low_change/big_swing/steady)
        //   변동률 10% 초과=big_swing, 그 외 변경=price_low_change, 신규(직전 없음)=price_low_change
        impact_level: cur != null && cur > 0 && Math.abs(latest - cur) / cur > 0.1 ? 'big_swing' : 'price_low_change',
        status: 'pending',
        current_iteration: 1,
        current_extracted: {
          model_name: prod.model_name,
          memory: prod.memory,
          supplier: supplierName,
          price_usd: latest,
          gpu_count: Math.max(1, Number(prod.gpu_count) || 1),
          pricing_model: 'on-demand',
          // 086 부분 unique 가드(source_market_price_id) 적용을 위해 출처 시장가 id 전파 → commit이 supply_quotes에 기록
          source_market_price_id: latestRow.price_id,
          notes: `경쟁사 '${comp.name}' 시장가 동기화${cur != null ? ` (직전 공급원가 $${cur.toFixed(4)} → $${latest.toFixed(4)})` : ''}`,
        },
        current_confidence: null,
        overall_confidence: 90,
        is_test: false,
      })
      created++
    }
  }

  if (rows.length > 0) {
    const { error } = await db.from('review_items').insert(rows)
    if (error) {
      console.error('[market/sync-cost] review_items insert', error)
      return NextResponse.json({ error: '동기화 검토 등록에 실패했습니다' }, { status: 500 })
    }
  }

  await recordGpuAudit(db, {
    actor, actionType: 'market_price_updated',
    detail: { op: 'market_cost_synced', competitors: competitors.length, created, skipped, only_competitor_id: onlyCompetitorId },
  })

  return NextResponse.json({ created, skipped, competitors: competitors.length })
}
