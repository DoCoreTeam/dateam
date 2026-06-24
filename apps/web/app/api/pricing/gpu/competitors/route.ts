import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { findMergeSuggestions, type CompetitorIdentity } from '@/lib/gpu/resolve-competitor'

// GET /api/pricing/gpu/competitors — 경쟁사 목록 + 통계(매핑수·시장가수·연결 공급사)
export async function GET() {
  try {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const { data: competitors, error } = await db
      .from('competitors')
      .select('id, name, short_name, type, region, country, color, website_url, pricing_url, is_active, supplier_id, aliases, created_at')
      .is('deleted_at', null)
      .order('name')
    if (error) throw error

    const ids = (competitors ?? []).map((c: Record<string, unknown>) => c.id as string)

    // 매핑(모델 연결) — 경쟁사별 매핑수 + 매핑id 수집
    const { data: mappings } = ids.length > 0
      ? await db.from('competitor_product_mapping').select('id, competitor_id').in('competitor_id', ids).eq('is_active', true)
      : { data: [] }
    const mapCountByComp = new Map<string, number>()
    const mappingIds: string[] = []
    const compByMapping = new Map<string, string>()
    for (const m of mappings ?? []) {
      const row = m as { id: string; competitor_id: string }
      mapCountByComp.set(row.competitor_id, (mapCountByComp.get(row.competitor_id) ?? 0) + 1)
      mappingIds.push(row.id)
      compByMapping.set(row.id, row.competitor_id)
    }

    // 시장가 — 매핑별 활성 시장가 수 → 경쟁사로 집계
    const { data: prices } = mappingIds.length > 0
      ? await db.from('market_prices').select('mapping_id').in('mapping_id', mappingIds).is('deleted_at', null)
      : { data: [] }
    const priceCountByComp = new Map<string, number>()
    for (const p of prices ?? []) {
      const compId = compByMapping.get((p as { mapping_id: string }).mapping_id)
      if (compId) priceCountByComp.set(compId, (priceCountByComp.get(compId) ?? 0) + 1)
    }

    // 연결 공급사명
    const supIds = Array.from(new Set((competitors ?? [])
      .map((c: Record<string, unknown>) => c.supplier_id as string | null)
      .filter(Boolean))) as string[]
    const supNameById = new Map<string, string>()
    if (supIds.length > 0) {
      const { data: sups } = await db.from('suppliers').select('id, name').in('id', supIds)
      for (const s of sups ?? []) supNameById.set((s as { id: string }).id, (s as { name: string }).name)
    }

    const result = (competitors ?? []).map((c: Record<string, unknown>) => ({
      ...c,
      mapping_count: mapCountByComp.get(c.id as string) ?? 0,
      market_price_count: priceCountByComp.get(c.id as string) ?? 0,
      is_supplier: !!c.supplier_id,
      linked_supplier_name: c.supplier_id ? (supNameById.get(c.supplier_id as string) ?? null) : null,
    }))

    // 병합 제안 — 도메인/정규화 이름이 같은 회사 클러스터(2개+). 과병합 방지: 토큰 겹침만으론 안 묶음.
    const identities: CompetitorIdentity[] = (competitors ?? []).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      name: c.name as string,
      short_name: (c.short_name as string | null) ?? null,
      website_url: (c.website_url as string | null) ?? null,
      aliases: (c.aliases as string[] | null) ?? null,
    }))
    const mergeSuggestions = findMergeSuggestions(identities)

    return NextResponse.json({ competitors: result, merge_suggestions: mergeSuggestions })
  } catch (err) {
    console.error('[gpu/competitors GET]', err)
    return NextResponse.json({ error: '경쟁사 목록을 불러오지 못했습니다' }, { status: 500 })
  }
}

const TYPES = ['hyperscaler', 'specialist', 'marketplace', 'domestic']
const COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#f97316']

// POST /api/pricing/gpu/competitors — 경쟁사 등록
export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '경쟁사명은 필수입니다' }, { status: 400 })
  const type = typeof body.type === 'string' && TYPES.includes(body.type) ? body.type : 'specialist'
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db
    .from('competitors')
    .insert({
      name,
      short_name: str(body.short_name) ?? name.slice(0, 12),
      type,
      region: str(body.region) ?? 'global',
      country: str(body.country),
      color: str(body.color) ?? COLORS[Math.floor(name.length % COLORS.length)],
      website_url: str(body.website_url),
      pricing_url: str(body.pricing_url),
      is_active: true,
    })
    .select()
    .single()
  if (error) {
    console.error('[gpu/competitors POST]', error)
    return NextResponse.json({ error: '경쟁사 등록에 실패했습니다' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: { op: 'competitor_created', competitor_id: data.id, name },
  })
  revalidateGpu()
  return NextResponse.json({ competitor: data })
}
