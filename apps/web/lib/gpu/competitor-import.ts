import { normalizeMemory } from '@/lib/gpu/normalize'
import { inferTier } from '@/lib/gpu/tier-dict'

export interface CompetitorPriceItem {
  competitor_name: string
  model_name: string
  memory?: string
  price_usd: number
  pricing_model?: string
  notes?: string
}

// 경쟁사 가격 DB 저장 (find-or-create 경쟁사·모델·매핑 후 시세 insert). service_role(adminClient) 필요.
export async function saveCompetitorPrices(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  items: CompetitorPriceItem[],
  sourceUrl: string | null,
): Promise<{ competitor: string; model: string; memory: string; price_usd: number }[]> {
  const saved: { competitor: string; model: string; memory: string; price_usd: number }[] = []
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

    let gpuProductId: string
    const memory = normalizeMemory(item.memory ?? '')
    const { data: existingGpu } = await db.from('gpu_products').select('id').ilike('model_name', item.model_name.trim()).eq('memory', memory).single()
    if (existingGpu?.id) {
      gpuProductId = existingGpu.id
    } else {
      const { data: newGpu, error: gpuErr } = await db.from('gpu_products')
        .insert({ model_name: item.model_name.trim(), memory, tier: inferTier(item.model_name.trim()), pricing_mode: 'quote', gpu_count: 1, vcpu: 12, ram_gb: 16, storage_gb: 512 }).select('id').single()
      if (gpuErr || !newGpu) { console.error('[competitor] GPU 모델 생성 실패:', gpuErr?.message); continue }
      gpuProductId = newGpu.id
    }

    let mappingId: string
    const pricingModel = (item.pricing_model ?? 'on_demand').replace(/-/g, '_')
    const { data: existingMap } = await db.from('competitor_product_mapping').select('id')
      .eq('competitor_id', competitorId).eq('gpu_product_id', gpuProductId).eq('pricing_model', pricingModel).single()
    if (existingMap?.id) {
      mappingId = existingMap.id
    } else {
      const sku = `${item.model_name} ${memory} (${pricingModel})`.trim()
      const { data: newMap, error: mapErr } = await db.from('competitor_product_mapping')
        .insert({ competitor_id: competitorId, gpu_product_id: gpuProductId, competitor_sku: sku, pricing_model: pricingModel, is_active: true }).select('id').single()
      if (mapErr || !newMap) { console.error('[competitor] 매핑 생성 실패:', mapErr?.message); continue }
      mappingId = newMap.id
    }

    await db.from('market_prices').insert({
      mapping_id: mappingId, price_usd: item.price_usd, source_url: sourceUrl,
      source_type: sourceUrl ? 'webpage' : 'manual', recorded_at: now, observed_at: now,
      confidence: 85, is_stale: false, ...(item.notes ? { notes: item.notes } : {}),
    })
    saved.push({ competitor: item.competitor_name, model: item.model_name, memory: memory ?? '', price_usd: item.price_usd })
  }
  return saved
}
