import { normalizeMemory } from '@/lib/gpu/normalize'
import { resolveProductId, type ResolveHeldReason } from '@/lib/gpu/resolve-product'

export interface CompetitorPriceItem {
  competitor_name: string
  model_name: string
  memory?: string
  price_usd: number
  pricing_model?: string
  notes?: string
}

export interface SaveCompetitorResult {
  saved: { competitor: string; model: string; memory: string; price_usd: number }[]
  /** 매칭 실패로 깡통 생성 대신 보류된 항목(사람 처리 필요) */
  held: { model: string; reason: ResolveHeldReason }[]
}

export interface SaveCompetitorOptions {
  /** market_prices.source_url + 매핑 competitor_url 갱신용(웹 새로고침 경로) */
  sourceUrl?: string | null
  confidence?: number
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

  for (const item of items) {
    if (!item.competitor_name || !item.model_name || !item.price_usd) continue

    let competitorId: string
    const { data: existingComp } = await db.from('competitors').select('id').ilike('name', item.competitor_name.trim()).single()
    if (existingComp?.id) {
      competitorId = existingComp.id
    } else {
      const compName = item.competitor_name.trim()
      const { data: newComp, error: compErr } = await db.from('competitors')
        .insert({ name: compName, short_name: compName.slice(0, 20), type: 'specialist' }).select('id').single()
      if (compErr || !newComp) { console.error('[competitor] 경쟁사 생성 실패:', compErr?.message); continue }
      competitorId = newComp.id
    }

    // 모델 변형 매칭 — resolveProductId SSOT(읽기 전용). 경쟁사 on-demand=1장. 매칭 실패 시 깡통 생성 대신 보류.
    const memory = normalizeMemory(item.memory ?? '')
    const resolved = await resolveProductId(db, { modelName: item.model_name, gpuCount: 1, memory: item.memory ?? null })
    if ('held' in resolved) { held.push({ model: item.model_name, reason: resolved.reason }); continue }
    const gpuProductId: string = resolved.productId

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
    })
    saved.push({ competitor: item.competitor_name, model: item.model_name, memory: memory ?? '', price_usd: item.price_usd })
  }
  return { saved, held }
}
