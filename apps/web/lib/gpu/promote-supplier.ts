// 경쟁사 → 공급사 승격 공용 로직 (SSOT) — 단건 라우트·일괄(bulk) 라우트 공유.
//   ① 공급사 자동생성/재사용 + 정보 풀복사·백필  ② 경쟁사 시장가를 cost 견적 일괄 인입(스냅샷)
import { logoFromWebsite, ensureSupplierAccount } from '@/lib/gpu/supplier-create'
import { recordGpuAudit } from '@/lib/gpu/audit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface PromoteResult {
  ok: boolean
  error?: string
  supplier?: { id: string; name: string }
  reused?: boolean
  already_linked?: boolean
  ingested_cost_quotes?: number
}

// 경쟁사의 현재 시장가를 supplier의 cost 견적으로 일괄 인입(스냅샷). 신규 인입 건수 반환.
export async function bulkIngestMarketCost(
  db: Db, competitorId: string, supplierId: string, accountId: string | null, actor: string,
): Promise<number> {
  const { data: mappings } = await db
    .from('competitor_product_mapping')
    .select('id, gpu_product_id')
    .eq('competitor_id', competitorId)
    .eq('is_active', true)
  const mapList = (mappings ?? []).filter((m: { gpu_product_id?: string }) => m.gpu_product_id)
  if (mapList.length === 0) return 0
  const mappingIds = mapList.map((m: { id: string }) => m.id)
  const productIds = Array.from(new Set(mapList.map((m: { gpu_product_id: string }) => m.gpu_product_id)))

  const { data: prices } = await db
    .from('market_prices')
    .select('id, mapping_id, price_usd, recorded_at')
    .in('mapping_id', mappingIds)
    .is('deleted_at', null)
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
  const latestByMapping = new Map<string, { id: string; price_usd: number }>()
  for (const p of prices ?? []) {
    const row = p as { id: string; mapping_id: string; price_usd: number }
    if (!latestByMapping.has(row.mapping_id)) latestByMapping.set(row.mapping_id, { id: row.id, price_usd: row.price_usd })
  }
  if (latestByMapping.size === 0) return 0

  const { data: products } = await db.from('gpu_products').select('id, gpu_count').in('id', productIds)
  const gpuCountById = new Map<string, number>()
  for (const p of products ?? []) {
    const row = p as { id: string; gpu_count: number }
    gpuCountById.set(row.id, Math.max(1, Number(row.gpu_count) || 1))
  }

  const candidateMpIds = Array.from(latestByMapping.values()).map((v) => v.id)
  const { data: existing } = await db
    .from('supply_quotes')
    .select('source_market_price_id')
    .in('source_market_price_id', candidateMpIds)
    .eq('price_type', 'cost')
    .is('deleted_at', null)
  const alreadyIngested = new Set<string>(
    (existing ?? []).map((e: { source_market_price_id: string }) => e.source_market_price_id),
  )

  const nowIso = new Date().toISOString()
  const rows: Record<string, unknown>[] = []
  for (const m of mapList) {
    const latest = latestByMapping.get(m.id)
    if (!latest || alreadyIngested.has(latest.id)) continue
    const priceUsd = Number(latest.price_usd)
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue
    rows.push({
      product_id: m.gpu_product_id,
      supplier_id: supplierId,
      account_id: accountId,
      unit_price_usd: priceUsd,
      gpu_count: gpuCountById.get(m.gpu_product_id) ?? 1,
      price_type: 'cost',
      status: 'confirmed',
      source_format: 'market_link',
      source_market_price_id: latest.id,
      source_competitor_id: competitorId,
      received_at: nowIso,
      registered_by: actor,
    })
  }
  if (rows.length === 0) return 0
  const { error } = await db.from('supply_quotes').insert(rows)
  if (error) { console.error('[promote-supplier] bulk cost insert', error); return 0 }
  return rows.length
}

// 경쟁사 1곳을 공급사로 승격(생성/연결 + 정보 백필 + 시장가 일괄 인입). 멱등.
export async function promoteCompetitorToSupplier(
  db: Db, competitorId: string, actorUserId: string, actor: string,
): Promise<PromoteResult> {
  const { data: comp, error: compErr } = await db
    .from('competitors')
    .select('id, name, short_name, type, region, color, website_url, pricing_url, supplier_id')
    .eq('id', competitorId)
    .is('deleted_at', null)
    .maybeSingle()
  if (compErr) { console.error('[promote-supplier] competitor lookup', compErr); return { ok: false, error: '요청 처리 실패' } }
  if (!comp) return { ok: false, error: '경쟁사를 찾을 수 없습니다' }

  const website = (comp.website_url as string | null) || (comp.pricing_url as string | null) || null
  const description = `시장비교 경쟁사 '${comp.name}'에서 공급사로 전환${comp.type ? ` · 유형 ${comp.type}` : ''}`

  let supplierId: string | null = comp.supplier_id ?? null
  let reused = false
  let autoCreated = false

  if (!supplierId) {
    const { data: dupSup } = await db.from('suppliers').select('id, name').ilike('name', comp.name).maybeSingle()
    if (dupSup) {
      supplierId = dupSup.id as string
      reused = true
    } else {
      const { data: created, error: insErr } = await db
        .from('suppliers')
        .insert({ name: comp.name, color: comp.color ?? null, country: comp.region ?? null, website, description, logo_url: logoFromWebsite(website), source: 'competitor_link' })
        .select('id, name').single()
      if (insErr || !created) { console.error('[promote-supplier] supplier insert', insErr); return { ok: false, error: '공급사 생성 실패' } }
      supplierId = created.id as string
      autoCreated = true
      await ensureSupplierAccount(db, { id: supplierId, name: created.name as string, country: comp.region ?? null, website, description, color: comp.color ?? null, logo_url: logoFromWebsite(website) }, actorUserId)
    }
    const { error: linkErr } = await db.from('competitors').update({ supplier_id: supplierId }).eq('id', competitorId)
    if (linkErr) {
      console.error('[promote-supplier] link update', linkErr)
      if (autoCreated && supplierId) await db.from('suppliers').delete().eq('id', supplierId).eq('source', 'competitor_link')
      return { ok: false, error: '연결 실패' }
    }
  }

  // 빈 필드 백필 + account_id 확보
  let accountId: string | null = null
  try {
    const { data: sup } = await db.from('suppliers').select('account_id, country, website, description').eq('id', supplierId).maybeSingle()
    accountId = sup?.account_id ?? null
    const fill: Record<string, unknown> = {}
    if (!sup?.country && comp.region) fill.country = comp.region
    if (!sup?.website && website) fill.website = website
    if (!sup?.description) fill.description = description
    if (Object.keys(fill).length > 0) { fill.updated_at = new Date().toISOString(); await db.from('suppliers').update(fill).eq('id', supplierId) }
  } catch { /* 비치명적 */ }

  const ingestedCount = await bulkIngestMarketCost(db, competitorId, supplierId as string, accountId, actor)

  await recordGpuAudit(db, {
    actor,
    actionType: 'market_price_updated',
    detail: { op: 'competitor_promoted_supplier', competitor_id: competitorId, competitor_name: comp.name, supplier_id: supplierId, reused_existing: reused, ingested_cost_quotes: ingestedCount },
  })

  return { ok: true, supplier: { id: supplierId as string, name: comp.name }, reused, already_linked: !!comp.supplier_id, ingested_cost_quotes: ingestedCount }
}
