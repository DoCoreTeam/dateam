import { normalizeMemory } from '@/lib/gpu/normalize'
import { resolveProductId, type ResolveHeldReason } from '@/lib/gpu/resolve-product'
import { resolveCompetitorId, type CompetitorIdentity } from '@/lib/gpu/resolve-competitor'
import type { VariantCandidate } from '@/lib/gpu/resolve-product'

export interface CompetitorPriceItem {
  competitor_name: string
  model_name: string
  memory?: string
  /** USD 정규화 가격(GPU 1장·1시간당). 통화 미상/환산불가면 null(저장 시 스킵). */
  price_usd: number | null
  pricing_model?: string
  notes?: string
  /** 원본 통화(ISO, 'KRW'|'USD'). 보존용 — price_usd는 fx 실환율 USD 정규화값. 미상이면 생략(기존행=USD 가정). */
  original_currency?: string | null
  /** 원본 통화 기준 금액(GPU 1장·1시간당). 보존용. */
  original_price?: number | null
}

export interface SaveCompetitorResult {
  saved: { competitor: string; model: string; memory: string; price_usd: number }[]
  /** 매칭 실패로 깡통 생성 대신 보류된 항목(사람 처리 필요). candidates=메모리 변형 후보(ambiguous_variant) */
  held: { model: string; reason: ResolveHeldReason; candidates?: VariantCandidate[] }[]
}

export interface SaveCompetitorOptions {
  /** market_prices.source_url + 매핑 competitor_url 갱신용(웹 새로고침 경로) */
  sourceUrl?: string | null
  confidence?: number
  /** 사용자가 검토 화면에서 고른 카탈로그 변형 id(ambiguous_variant 해소). 있으면 resolveProductId 대신 이 변형에 직접 결합(기존 행만 — 깡통 생성 아님). 단일 item일 때만 의미. */
  targetProductId?: string | null
}

// 경쟁사 가격 DB 저장. 모델은 resolveProductId SSOT로 기존 변형에만 결합 — 매칭 실패 시 깡통 자동생성 금지(보류).
//   service_role(adminClient) 필요. (재사용·단일구현: confirm·refresh 양 경로가 이 함수만 호출)
export async function saveCompetitorPrices(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  items: CompetitorPriceItem[],
  opts: SaveCompetitorOptions = {},
): Promise<SaveCompetitorResult> {
  const sourceUrl = opts.sourceUrl ?? null
  const confidence = typeof opts.confidence === 'number' ? opts.confidence : 85
  const saved: SaveCompetitorResult['saved'] = []
  const held: SaveCompetitorResult['held'] = []
  const now = new Date().toISOString()

  // 경쟁사 식별 SSOT — 기존 회사 1회 로드 후 도메인/별칭으로 해소(재발 중복 차단).
  //   매칭 실패 시에만 신규 생성하고 인메모리 목록에 추가 → 같은 배치 내 표기 변형도 한 회사로 흡수.
  const { data: allComps } = await db.from('competitors')
    .select('id, name, short_name, website_url, aliases').is('deleted_at', null)
  const existing: CompetitorIdentity[] = (allComps ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    short_name: (c.short_name as string | null) ?? null,
    website_url: (c.website_url as string | null) ?? null,
    aliases: (c.aliases as string[] | null) ?? null,
  }))

  for (const item of items) {
    if (!item.competitor_name || !item.model_name || !item.price_usd) continue

    let competitorId: string
    const resolvedCompId = resolveCompetitorId(
      { name: item.competitor_name.trim(), website_url: sourceUrl },
      existing,
    )
    if (resolvedCompId) {
      competitorId = resolvedCompId
    } else {
      const compName = item.competitor_name.trim()
      const { data: newComp, error: compErr } = await db.from('competitors')
        .insert({ name: compName, short_name: compName.slice(0, 20), type: 'specialist', ...(sourceUrl ? { website_url: sourceUrl } : {}) })
        .select('id').single()
      if (compErr || !newComp) { console.error('[competitor] 경쟁사 생성 실패:', compErr?.message); continue }
      competitorId = newComp.id
      // 같은 배치 후속 항목이 이 회사로 해소되도록 인메모리 목록에 추가
      existing.push({ id: competitorId, name: compName, short_name: compName.slice(0, 20), website_url: sourceUrl, aliases: [] })
    }

    // 모델 변형 매칭 — resolveProductId SSOT(읽기 전용). 경쟁사 on-demand=1장. 매칭 실패 시 깡통 생성 대신 보류.
    // 단, 사용자가 검토 화면에서 변형을 직접 고른 경우(targetProductId)엔 그 기존 변형에 결합(ambiguous 해소).
    const memory = normalizeMemory(item.memory ?? '')
    let gpuProductId: string
    if (opts.targetProductId) {
      // 경쟁사 on-demand=1장 — 사용자가 고른 변형도 1장 구성인지 재검증(공급사 경로와 대칭, 오결합 차단).
      const { data: chosen } = await db.from('gpu_products').select('id, gpu_count').eq('id', opts.targetProductId).is('deleted_at', null).maybeSingle()
      if (!chosen?.id) { held.push({ model: item.model_name, reason: 'no_model' }); continue }
      if ((chosen.gpu_count ?? 1) !== 1) { held.push({ model: item.model_name, reason: 'no_variant' }); continue }
      gpuProductId = chosen.id as string
    } else {
      const resolved = await resolveProductId(db, { modelName: item.model_name, gpuCount: 1, memory: item.memory ?? null })
      if ('held' in resolved) { held.push({ model: item.model_name, reason: resolved.reason, candidates: resolved.candidates }); continue }
      gpuProductId = resolved.productId
    }

    let mappingId: string
    const pricingModel = (item.pricing_model ?? 'on_demand').replace(/-/g, '_')
    const { data: existingMap } = await db.from('competitor_product_mapping').select('id')
      .eq('competitor_id', competitorId).eq('gpu_product_id', gpuProductId).eq('pricing_model', pricingModel).single()
    if (existingMap?.id) {
      mappingId = existingMap.id
      if (sourceUrl) await db.from('competitor_product_mapping').update({ competitor_url: sourceUrl }).eq('id', mappingId)
    } else {
      const sku = `${item.model_name} ${memory ?? ''} (${pricingModel})`.trim()
      const { data: newMap, error: mapErr } = await db.from('competitor_product_mapping')
        .insert({ competitor_id: competitorId, gpu_product_id: gpuProductId, competitor_sku: sku, pricing_model: pricingModel, is_active: true, ...(sourceUrl ? { competitor_url: sourceUrl } : {}) }).select('id').single()
      if (mapErr || !newMap) { console.error('[competitor] 매핑 생성 실패:', mapErr?.message); continue }
      mappingId = newMap.id
    }

    await db.from('market_prices').insert({
      mapping_id: mappingId, price_usd: item.price_usd, source_url: sourceUrl,
      source_type: sourceUrl ? 'webpage' : 'manual', recorded_at: now, observed_at: now,
      confidence, is_stale: false, ...(item.notes ? { notes: item.notes } : {}),
      // 원본 통화·금액 보존(W4) — 표시 시 fx 실환율로 양통화 병기. 미상이면 생략(기존행=USD 가정).
      ...(item.original_currency ? { original_currency: item.original_currency } : {}),
      ...(typeof item.original_price === 'number' ? { original_price: item.original_price } : {}),
    })
    saved.push({ competitor: item.competitor_name, model: item.model_name, memory: memory ?? '', price_usd: item.price_usd })
  }
  return { saved, held }
}
