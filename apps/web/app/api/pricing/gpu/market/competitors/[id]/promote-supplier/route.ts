import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { logoFromWebsite, ensureSupplierAccount } from '@/lib/gpu/supplier-create'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/pricing/gpu/market/competitors/[id]/promote-supplier
//   경쟁사를 "우리 공급사"로 1클릭 지정 — 실제 공급사로 완전 등록.
//   - 이미 supplier_id 연결됨 → 멱등(기존 반환, 단 견적 일괄 인입은 재시도)
//   - suppliers에 동명 회사 있으면 그 row 재사용(중복 생성 금지)
//   - 없으면 자동생성 + 경쟁사 정보 풀복사(country=region·website·color·description)
//   - 그 경쟁사의 현재 시장가 전부를 cost 견적으로 일괄 인입(스냅샷, 중복가드)
//     → 공급사 카드에 견적이 채워지고 buildCatalog 최저공급가/판매가에 반영
//   정책: 인입은 승격 시점 스냅샷(고정). 이후 시장가 변동은 자동 반영 안 함(지속 자동상승 방지 유지).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// 경쟁사의 현재 시장가를 supplier의 cost 견적으로 일괄 인입(스냅샷). 신규 인입 건수 반환.
async function bulkIngestMarketCost(
  db: Db, competitorId: string, supplierId: string, accountId: string | null, actor: string,
): Promise<number> {
  // 1) 경쟁사의 활성 매핑 (모델 연결된 것만)
  const { data: mappings } = await db
    .from('competitor_product_mapping')
    .select('id, gpu_product_id')
    .eq('competitor_id', competitorId)
    .eq('is_active', true)
  const mapList = (mappings ?? []).filter((m: { gpu_product_id?: string }) => m.gpu_product_id)
  if (mapList.length === 0) return 0
  const mappingIds = mapList.map((m: { id: string }) => m.id)
  const productIds = Array.from(new Set(mapList.map((m: { gpu_product_id: string }) => m.gpu_product_id)))

  // 2) 매핑별 최신 시장가 (recorded_at desc 첫 행)
  const { data: prices } = await db
    .from('market_prices')
    .select('id, mapping_id, price_usd, recorded_at')
    .in('mapping_id', mappingIds)
    .is('deleted_at', null)
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })   // 동일 recorded_at tiebreaker — 최신 선택 결정성 보장
  const latestByMapping = new Map<string, { id: string; price_usd: number }>()
  for (const p of prices ?? []) {
    const row = p as { id: string; mapping_id: string; price_usd: number }
    if (!latestByMapping.has(row.mapping_id)) latestByMapping.set(row.mapping_id, { id: row.id, price_usd: row.price_usd })
  }
  if (latestByMapping.size === 0) return 0

  // 3) gpu_count 룩업
  const { data: products } = await db
    .from('gpu_products').select('id, gpu_count').in('id', productIds)
  const gpuCountById = new Map<string, number>()
  for (const p of products ?? []) {
    const row = p as { id: string; gpu_count: number }
    gpuCountById.set(row.id, Math.max(1, Number(row.gpu_count) || 1))
  }

  // 4) 이미 인입된 source_market_price_id 집합(중복 가드)
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

  // 5) 신규 cost 견적 일괄 구성
  const nowIso = new Date().toISOString()
  const rows: Record<string, unknown>[] = []
  for (const m of mapList) {
    const latest = latestByMapping.get(m.id)
    if (!latest) continue
    if (alreadyIngested.has(latest.id)) continue
    const priceUsd = Number(latest.price_usd)
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue
    rows.push({
      product_id: m.gpu_product_id,
      supplier_id: supplierId,
      account_id: accountId,
      unit_price_usd: priceUsd,                 // 승격 시점 시장가 스냅샷(고정)
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

  const { error: insErr } = await db.from('supply_quotes').insert(rows)
  if (insErr) {
    console.error('[promote-supplier] bulk cost insert', insErr)
    return 0
  }
  return rows.length
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: '경쟁사 ID 형식 오류' }, { status: 400 })
  }

  const db = createAdminClient() as Db
  const actor = auth.user.email ?? auth.user.id

  // 대상 경쟁사 조회 (정보 풀복사용 컬럼 포함)
  const { data: comp, error: compErr } = await db
    .from('competitors')
    .select('id, name, short_name, type, region, color, website_url, pricing_url, supplier_id')
    .eq('id', id)
    .maybeSingle()
  if (compErr) {
    console.error('[promote-supplier] competitor lookup', compErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!comp) {
    return NextResponse.json({ error: '경쟁사를 찾을 수 없습니다' }, { status: 404 })
  }

  const website = (comp.website_url as string | null) || (comp.pricing_url as string | null) || null
  const description = `시장비교 경쟁사 '${comp.name}'에서 공급사로 전환${comp.type ? ` · 유형 ${comp.type}` : ''}`

  // 이미 연결됨 → 멱등(기존 공급사 사용). 견적 일괄 인입은 재시도(누락분 보강).
  let supplierId: string | null = comp.supplier_id ?? null
  let reused = false
  let autoCreated = false

  if (!supplierId) {
    // 동명 supplier 재사용 (대소문자 무시)
    const { data: dupSup } = await db
      .from('suppliers').select('id, name').ilike('name', comp.name).maybeSingle()
    if (dupSup) {
      supplierId = dupSup.id as string
      reused = true
    } else {
      // 자동생성 — 경쟁사 정보 풀복사
      const { data: created, error: insErr } = await db
        .from('suppliers')
        .insert({
          name: comp.name,
          color: comp.color ?? null,
          country: comp.region ?? null,
          website,
          description,
          logo_url: logoFromWebsite(website),
          source: 'competitor_link',
        })
        .select('id, name')
        .single()
      if (insErr || !created) {
        console.error('[promote-supplier] supplier insert', insErr)
        return NextResponse.json({ error: '공급사 생성 실패' }, { status: 500 })
      }
      supplierId = created.id as string
      autoCreated = true
      await ensureSupplierAccount(db, {
        id: supplierId, name: created.name as string, country: comp.region ?? null,
        website, description, color: comp.color ?? null, logo_url: logoFromWebsite(website),
      }, auth.user.id)
    }

    // 경쟁사 ↔ 공급사 연결
    const { error: linkErr } = await db
      .from('competitors').update({ supplier_id: supplierId }).eq('id', id)
    if (linkErr) {
      console.error('[promote-supplier] link update', linkErr)
      if (autoCreated && supplierId) {
        await db.from('suppliers').delete().eq('id', supplierId).eq('source', 'competitor_link')
      }
      return NextResponse.json({ error: '연결 실패' }, { status: 500 })
    }
  }

  // 공급사 정보 백필 — 빈 필드만 경쟁사 정보로 채움(기존 수동 입력값은 보존). account_id도 확보.
  let accountId: string | null = null
  try {
    const { data: sup } = await db
      .from('suppliers')
      .select('account_id, country, website, description')
      .eq('id', supplierId).maybeSingle()
    accountId = sup?.account_id ?? null
    const fill: Record<string, unknown> = {}
    if (!sup?.country && comp.region) fill.country = comp.region
    if (!sup?.website && website) fill.website = website
    if (!sup?.description) fill.description = description
    if (Object.keys(fill).length > 0) {
      fill.updated_at = new Date().toISOString()
      await db.from('suppliers').update(fill).eq('id', supplierId)
    }
  } catch { /* 비치명적 */ }

  // 경쟁사 시장가 → cost 견적 일괄 인입(스냅샷, 중복가드)
  const ingestedCount = await bulkIngestMarketCost(db, id, supplierId as string, accountId, actor)

  await recordGpuAudit(db, {
    actor,
    actionType: 'market_price_updated',
    detail: {
      op: 'competitor_promoted_supplier',
      competitor_id: id,
      competitor_name: comp.name,
      supplier_id: supplierId,
      reused_existing: reused,
      ingested_cost_quotes: ingestedCount,
    },
  })

  revalidateGpu()
  return NextResponse.json({
    supplier: { id: supplierId, name: comp.name },
    reused,
    already_linked: !!comp.supplier_id,
    ingested_cost_quotes: ingestedCount,
  })
}
